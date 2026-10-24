import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

async function fixture(t) {
	const directory = mkdtempSync(join(tmpdir(), 'voice-diag-api-'));
	const socket = createServer();
	await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
	const port = socket.address().port;
	await new Promise((resolve) => socket.close(resolve));
	const env = {
		...process.env,
		PORT: String(port),
		NODE_ENV: 'test',
		DB_PATH: join(directory, 'app.db'),
		DIAGNOSTICS_DB_PATH: join(directory, 'diagnostics.db'),
		INVITE_CODES: '{"test-invite":"home"}',
		SESSION_SECRET: 'test-session-secret',
		LIVEKIT_URL: '',
		LIVEKIT_API_KEY: 'test-key',
		LIVEKIT_API_SECRET: 'test-secret-at-least-thirty-two-characters',
	};
	const cwd = resolve('backend');
	const seed = spawnSync(process.execPath, ['seed/seed.js'], {
		cwd,
		env,
		encoding: 'utf8',
	});
	assert.equal(seed.status, 0, seed.stderr);
	const child = spawn(process.execPath, ['src/server.js'], {
		cwd,
		env,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let output = '';
	child.stdout.on('data', (chunk) => (output += chunk));
	child.stderr.on('data', (chunk) => (output += chunk));
	t.after(async () => {
		child.kill('SIGTERM');
		await Promise.race([
			new Promise((resolve) => child.once('exit', resolve)),
			new Promise((resolve) => setTimeout(resolve, 5000)),
		]);
		if (child.exitCode === null) child.kill('SIGKILL');
		rmSync(directory, { recursive: true, force: true });
	});
	const url = `http://127.0.0.1:${port}`;
	for (let i = 0; i < 100; i++) {
		try {
			const r = await fetch(url + '/api/health');
			if (r.ok) break;
		} catch {}
		if (i === 99) throw new Error(output);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	const request = (path, { cookie, body, method = 'GET', headers = {} } = {}) =>
		fetch(url + path, {
			method,
			headers: {
				'Content-Type': 'application/json',
				...(cookie ? { Cookie: cookie } : {}),
				...headers,
			},
			...(body ? { body: JSON.stringify(body) } : {}),
		});
	const signup = async (username) => {
		const r = await request('/api/signup', {
			method: 'POST',
			body: {
				username,
				password: 'testing-password',
				inviteCode: 'test-invite',
			},
		});
		assert.equal(r.status, 201);
		return r.headers.get('set-cookie').split(';')[0];
	};
	return { request, signup };
}

test('signed-in members can read diagnostics; ingestion validates ownership and records token correlation', async (t) => {
	const { request, signup } = await fixture(t);
	const cookie = await signup('alice');
	const other = await signup('bob');
	assert.equal((await request('/api/diagnostics/overview')).status, 401);
	const id = randomUUID();
	const body = { id, roomName: 'home', clientInfo: { browser: 'Test' } };
	assert.equal(
		(
			await request('/api/diagnostics/sessions', {
				method: 'POST',
				cookie,
				body,
			})
		).status,
		200,
	);
	assert.equal(
		(
			await request('/api/diagnostics/sessions', {
				method: 'POST',
				cookie: other,
				body,
			})
		).status,
		409,
	);
	const token = await request('/api/livekit-token', {
		method: 'POST',
		cookie,
		body: { roomName: 'home', diagnosticSessionId: id },
	});
	assert.equal(token.status, 200);
	const jwt = (await token.json()).token;
	const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url'));
	assert.equal(JSON.parse(claims.metadata).diagnosticSessionId, id);
	const batch = {
		events: [
			{
				seq: 0,
				at: Date.now(),
				type: 'connected',
				message: 'Connected',
				details: {},
			},
		],
		samples: [
			{
				seq: 1,
				at: Date.now(),
				data: { connectionState: 'connected', transports: [] },
			},
		],
	};
	assert.equal(
		(
			await request(`/api/diagnostics/sessions/${id}/batch`, {
				method: 'POST',
				cookie: other,
				body: batch,
			})
		).status,
		404,
	);
	assert.equal(
		(
			await request(`/api/diagnostics/sessions/${id}/batch`, {
				method: 'POST',
				cookie,
				body: batch,
			})
		).status,
		200,
	);
	const overview = await (
		await request('/api/diagnostics/overview', { cookie: other })
	).json();
	assert.equal(overview.calls.length, 1);
	const call = await (
		await request('/api/diagnostics/calls/' + overview.calls[0].id, {
			cookie: other,
		})
	).json();
	assert.equal(call.sessions[0].username, 'alice');
	const events = await (
		await request(`/api/diagnostics/events?sessionId=${id}`, { cookie })
	).json();
	assert.ok(events.some((e) => e.type === 'token_issued'));
	const syncUrl = '/api/diagnostics/calls/' + overview.calls[0].id + '?sync=1';
	const initial = await (await request(syncUrl, { cookie })).json();
	assert.deepEqual(initial.data, call);
	const unchanged = await (
		await request(syncUrl + '&revision=' + initial.revision, { cookie: other })
	).json();
	assert.deepEqual(unchanged.changes, []);
	assert.equal(
		(await request(syncUrl + '&revision=' + initial.revision)).status,
		401,
	);

	assert.equal(
		(
			await request(`/api/diagnostics/sessions/${id}/batch`, {
				method: 'POST',
				cookie,
				body: { samples: Array(21).fill(batch.samples[0]) },
			})
		).status,
		400,
	);
	assert.equal(
		(
			await request('/api/diagnostics/internal', {
				method: 'POST',
				body: { services: {}, events: [] },
			})
		).status,
		401,
	);
	assert.equal(
		(
			await request('/api/diagnostics/webhook', {
				method: 'POST',
				headers: { 'Content-Type': 'application/webhook+json' },
				body: { id: 'fake' },
			})
		).status,
		401,
	);
});
