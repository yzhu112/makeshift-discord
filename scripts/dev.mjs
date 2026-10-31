#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { delimiter, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = join(root, 'backend');
const container = `makeshift-local-${process.pid}-${Date.now()}`;
const children = new Set();
let stopping = false;
let containerStarted = false;

function log(message) {
	console.log(`[local] ${message}`);
}
function command(program, args, options = {}) {
	const result = spawnSync(program, args, { encoding: 'utf8', ...options });
	if (result.error || result.status !== 0)
		throw new Error(
			result.error?.message || result.stderr?.trim() || `${program} failed`,
		);
	return result.stdout.trim();
}

function selectNode() {
	// Native SQLite must run under the Node version it was installed with.
	// Try the current runtime, then Node beside pnpm and other PATH entries.
	const candidates = [
		...new Set(
			[
				process.execPath,
				process.env.npm_node_execpath,
				...(process.env.PATH || '')
					.split(delimiter)
					.map((path) => join(path, 'node')),
			].filter(Boolean),
		),
	];
	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		const check = spawnSync(
			candidate,
			[
				'--input-type=module',
				'-e',
				"import { createMainDbService } from '@voice/db'; const db = createMainDbService(':memory:'); db.close();",
			],
			{ cwd: backend, stdio: 'ignore' },
		);
		if (check.status === 0) return candidate;
	}
	throw new Error(
		'No installed Node runtime can load better-sqlite3. Run pnpm install (or pnpm rebuild better-sqlite3) with your chosen Node version, then retry.',
	);
}

async function available(port, udp = false) {
	await new Promise((resolve, reject) => {
		const socket = udp ? createSocket('udp4') : createServer();
		socket.once('error', (error) => {
			try {
				socket.close();
			} catch {}
			reject(
				new Error(
					`Port ${port}/${udp ? 'UDP' : 'TCP'} is unavailable: ${error.code}. Stop the service using it, then retry.`,
				),
			);
		});
		const ready = () => socket.close(resolve);
		if (udp) socket.bind(port, '127.0.0.1', ready);
		else socket.listen(port, '127.0.0.1', ready);
	});
}

function start(name, program, args, env) {
	const child = spawn(program, args, {
		cwd:
			name === 'backend'
				? backend
				: name === 'frontend'
					? join(root, 'frontend')
					: root,
		env,
		detached: true,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	children.add(child);
	for (const stream of [child.stdout, child.stderr]) {
		createInterface({ input: stream }).on('line', (line) =>
			console.log(`[${name}] ${line}`),
		);
	}
	child.once('error', (error) => {
		console.error(`[${name}] ${error.message}`);
		void stop(1);
	});
	child.once('exit', (code, signal) => {
		if (!stopping) {
			console.error(
				`[${name}] exited (${signal || code}); stopping the local stack.`,
			);
			void stop(code === 0 ? 0 : 1);
		}
	});
	return child;
}

async function ready(url, label) {
	for (let attempt = 0; attempt < 120; attempt++) {
		if (stopping) throw new Error('Startup interrupted');
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
			if (response.ok) return;
		} catch {}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`${label} did not become ready at ${url}`);
}

function signalGroup(child, signal) {
	try {
		process.kill(-child.pid, signal);
	} catch (error) {
		if (error.code !== 'ESRCH') console.error(error.message);
	}
}
async function stop(code = 0) {
	if (stopping) return;
	stopping = true;
	log('Stopping local services…');
	const exits = [...children].map(
		(child) =>
			new Promise((resolve) => {
				if (child.exitCode !== null || child.signalCode !== null)
					return resolve();
				child.once('exit', resolve);
			}),
	);
	for (const child of children) signalGroup(child, 'SIGTERM');
	const docker = containerStarted
		? new Promise((resolve) => {
				const child = spawn('docker', ['rm', '-f', container], {
					stdio: 'ignore',
				});
				child.once('error', resolve);
				child.once('exit', resolve);
			})
		: Promise.resolve();
	let timeout;
	await Promise.race([
		Promise.all([...exits, docker]),
		new Promise((resolve) => {
			timeout = setTimeout(resolve, 6000);
		}),
	]);
	clearTimeout(timeout);
	for (const child of children) signalGroup(child, 'SIGKILL');
	log(
		'Stopped. Preview accounts and diagnostics are preserved in backend/data/.',
	);
	process.exit(code);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());

try {
	if (process.platform !== 'linux')
		throw new Error('This launcher uses Linux Docker host networking.');
	const node = selectNode();
	if (!existsSync(join(root, 'frontend/node_modules/vite/bin/vite.js')))
		throw new Error(
			'Frontend dependencies are missing. Run pnpm install first.',
		);
	command('docker', ['info', '--format', '{{.ServerVersion}}']);
	for (const port of [3000, 5173, 7880, 7881]) await available(port);
	await available(7882, true);
	const env = {
		...process.env,
		PATH: dirname(node) + delimiter + process.env.PATH,
		PORT: '3000',
		NODE_ENV: 'development',
		LIVEKIT_URL: 'ws://127.0.0.1:7880',
		LIVEKIT_API_KEY: 'devkey',
		LIVEKIT_API_SECRET: 'secret',
		SESSION_SECRET: 'local-preview-only',
		INVITE_CODES: '{"localtest":"home"}',
		DB_PATH: join(backend, 'data/preview.db'),
		DIAGNOSTICS_DB_PATH: join(backend, 'data/preview-diagnostics.db'),
	};
	log(`Using ${node}`);
	log('Preparing preview database…');
	log(
		command(node, ['seed/seed.js'], { cwd: backend, env }) || 'Database ready.',
	);
	// An attached, uniquely named container belongs only to this invocation.
	containerStarted = true;
	start(
		'livekit',
		'docker',
		[
			'run',
			'--rm',
			'--name',
			container,
			'--network',
			'host',
			'livekit/livekit-server:latest',
			'--dev',
			'--bind',
			'127.0.0.1',
			'--node-ip',
			'127.0.0.1',
		],
		env,
	);
	await ready('http://127.0.0.1:7880', 'LiveKit');
	start('backend', node, ['--watch', 'src/server.js'], env);
	await ready('http://127.0.0.1:3000/api/health', 'Backend');
	start(
		'frontend',
		node,
		[
			join(root, 'frontend/node_modules/vite/bin/vite.js'),
			'--host',
			'127.0.0.1',
			'--port',
			'5173',
			'--strictPort',
		],
		env,
	);
	await ready('http://127.0.0.1:5173', 'Frontend');
	log('Ready: http://localhost:5173');
	log('Diagnostics: http://localhost:5173/diagnostics');
	log('Sign up with invite code: localtest — then join home.');
	log(
		'Frontend hot reload and backend watch are enabled. Ctrl+C stops this stack.',
	);
} catch (error) {
	if (!stopping) console.error(`[local] ${error.message}`);
	await stop(1);
}
