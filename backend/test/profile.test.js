import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import test from 'node:test';
import Database from 'better-sqlite3';
import { PNG } from 'pngjs';
import CrcCalculator from 'pngjs/lib/crc.js';
import {
	MAX_AVATAR_BYTES,
	ProfileUpdateSchema,
} from '../src/middleware/profile.validation.js';

function png(width = 256, height = 256) {
	const data = Buffer.alloc(width * height * 4);
	// A transparent image with one opaque pixel exercises alpha preservation.
	data.set([255, 100, 50, 255]);
	return PNG.sync.write({ width, height, data });
}

function chunk(type, data) {
	const result = Buffer.alloc(data.length + 12);
	result.writeUInt32BE(data.length);
	result.write(type, 4);
	data.copy(result, 8);
	result.writeInt32BE(
		CrcCalculator.crc32(result.subarray(4, -4)),
		result.length - 4,
	);
	return result;
}

function sizedPng(size) {
	const image = png();
	const data = Buffer.alloc(size - image.length - 12, 65);
	data[1] = 0;
	return Buffer.concat([
		image.subarray(0, -12),
		chunk('tEXt', data),
		image.subarray(-12),
	]);
}

test('profile validation counts graphemes, trims names, supports clearing, and rejects invalid fields', () => {
	for (const name of [
		'小明',
		'山田 太郎',
		'أحمد',
		'e\u0301'.repeat(32),
		'👩🏽‍💻'.repeat(32),
	]) {
		const result = ProfileUpdateSchema.safeParse({
			display_name: `  ${name}  `,
		});
		assert.equal(result.success, true);
		assert.equal(result.data.display_name, name);
	}
	for (const patch of [
		{},
		{ display_name: '' },
		{ display_name: '  ' },
		{ display_name: '👩🏽‍💻'.repeat(33) },
		{ display_name: 12 },
		{ language: 'fr' },
		{ theme: 'blue' },
		{ id: 1 },
		{ password_hash: 'no' },
		{ updated_at: 1 },
		{ username: 'other' },
	])
		assert.equal(ProfileUpdateSchema.safeParse(patch).success, false);
	const cleared = {
		display_name: null,
		avatar: null,
		language: null,
		theme: null,
	};
	assert.deepEqual(ProfileUpdateSchema.parse(cleared), cleared);
	assert.deepEqual(ProfileUpdateSchema.parse({ theme: 'dark' }), {
		theme: 'dark',
	});
});

test('avatar validation decodes real still PNGs and enforces dimensions, bytes, and bounded inflation', () => {
	const valid = png();
	assert.deepEqual(
		ProfileUpdateSchema.parse({ avatar: valid.toString('base64') }).avatar,
		valid,
	);
	const exactLimit = sizedPng(MAX_AVATAR_BYTES);
	assert.deepEqual(
		ProfileUpdateSchema.parse({ avatar: exactLimit.toString('base64') }).avatar,
		exactLimit,
	);
	const animation = Buffer.concat([
		valid.subarray(0, 33),
		chunk('acTL', Buffer.from([0, 0, 0, 2, 0, 0, 0, 0])),
		valid.subarray(33),
	]);
	const badCrc = Buffer.from(valid);
	badCrc[29] ^= 1;
	const hugeDimensions = Buffer.from(valid);
	hugeDimensions.writeUInt32BE(100000, 16);
	const bomb = Buffer.concat([
		valid.subarray(0, 33),
		chunk('IDAT', deflateSync(Buffer.alloc(2 * 1024 * 1024))),
		valid.subarray(-12),
	]);
	for (const image of [
		png(128, 256),
		sizedPng(MAX_AVATAR_BYTES + 1),
		animation,
		badCrc,
		hugeDimensions,
		bomb,
		valid.subarray(0, -5),
		Buffer.from([255, 216, 255, 224]),
		Buffer.concat([valid, Buffer.from('extra')]),
	])
		assert.equal(
			ProfileUpdateSchema.safeParse({ avatar: image.toString('base64') })
				.success,
			false,
		);
	for (const avatar of [
		'',
		'!!!!',
		'data:image/png;base64,' + valid.toString('base64'),
		valid.toString('base64') + '\n',
	]) {
		assert.equal(ProfileUpdateSchema.safeParse({ avatar }).success, false);
	}
});

async function fixture(t) {
	const directory = mkdtempSync(join(tmpdir(), 'voice-profile-test-'));
	let child;
	t.after(async () => {
		try {
			if (child && child.exitCode === null && child.signalCode === null) {
				const exited = once(child, 'exit');
				child.kill('SIGTERM');
				const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
				try {
					await exited;
				} finally {
					clearTimeout(timeout);
				}
			}
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
	const socket = createServer();
	await new Promise((resolve, reject) => {
		socket.once('error', reject);
		socket.listen(0, '127.0.0.1', resolve);
	});
	const port = socket.address().port;
	await new Promise((resolve) => socket.close(resolve));
	const env = {
		...process.env,
		PORT: String(port),
		NODE_ENV: 'test',
		DB_PATH: join(directory, 'main.db'),
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
	child = spawn(process.execPath, ['src/server.js'], {
		cwd,
		env,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let output = '';
	child.stdout.on('data', (data) => {
		output += data;
	});
	child.stderr.on('data', (data) => {
		output += data;
	});
	const url = `http://127.0.0.1:${port}`;
	let ready = false;
	for (let i = 0; i < 100; i++) {
		try {
			if ((await fetch(url + '/api/health')).ok) {
				ready = true;
				break;
			}
		} catch {}
		if (child.exitCode !== null) break;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	assert.ok(ready, output);
	const request = (path, { cookie, body, raw, method = 'GET' } = {}) =>
		fetch(url + path, {
			method,
			headers: {
				'Content-Type': 'application/json',
				...(cookie ? { Cookie: cookie } : {}),
			},
			...(raw !== undefined
				? { body: raw }
				: body !== undefined
					? { body: JSON.stringify(body) }
					: {}),
		});
	const signup = async (username) => {
		const response = await request('/api/signup', {
			method: 'POST',
			body: {
				username,
				password: 'testing-password',
				inviteCode: 'test-invite',
			},
		});
		assert.equal(response.status, 201);
		return response.headers.get('set-cookie').split(';')[0];
	};
	const readUser = (id) => {
		const sqlite = new Database(env.DB_PATH, { readonly: true });
		try {
			return sqlite.prepare('SELECT * FROM users WHERE id = ?').get(id);
		} finally {
			sqlite.close();
		}
	};
	return { request, signup, readUser };
}

test('profile API saves only supplied fields, returns optional avatars, and rejects invalid updates atomically', async (t) => {
	const { request, signup, readUser } = await fixture(t);
	assert.equal((await request('/api/me')).status, 401);
	assert.equal(
		(await request('/api/me', { method: 'PATCH', body: { theme: 'dark' } }))
			.status,
		401,
	);
	const cookie = await signup('alice');
	const otherCookie = await signup('bob');
	const get = async (include = '') => {
		const response = await request('/api/me' + include, { cookie });
		assert.equal(response.status, 200);
		return response.json();
	};
	const initial = await get();
	const originalRow = readUser(initial.id);
	assert.equal(originalRow.created_at, originalRow.updated_at);
	assert.deepEqual(
		Object.keys(initial).sort(),
		[
			'id',
			'username',
			'display_name',
			'language',
			'theme',
			'updated_at',
			'rooms',
		].sort(),
	);
	assert.equal(initial.display_name, null);
	assert.equal(typeof initial.updated_at, 'number');
	assert.equal((await get('?include=avatar')).avatar, null);
	for (const include of [
		'password_hash',
		'id',
		'avatar,password_hash',
		'',
		'avatar&include=avatar',
	]) {
		assert.equal(
			(await request('/api/me?include=' + include, { cookie })).status,
			400,
		);
	}
	const avatar = sizedPng(MAX_AVATAR_BYTES).toString('base64');
	const response = await request('/api/me', {
		cookie,
		method: 'PATCH',
		body: {
			display_name: '  小明 👩🏽‍💻  ',
			language: 'ja',
			theme: 'dark',
			avatar,
		},
	});
	assert.equal(response.status, 200, await response.clone().text());
	const updated = await response.json();
	assert.equal(updated.display_name, '小明 👩🏽‍💻');
	assert.equal(updated.language, 'ja');
	assert.equal(updated.theme, 'dark');
	assert.ok(updated.updated_at >= initial.updated_at);
	assert.equal(Object.hasOwn(updated, 'avatar'), false);
	assert.deepEqual(updated.rooms, initial.rooms);
	const persisted = await get('?include=avatar');
	assert.equal(persisted.avatar, avatar);
	const updatedRow = readUser(initial.id);
	assert.equal(updatedRow.created_at, originalRow.created_at);
	assert.equal(updatedRow.password_hash, originalRow.password_hash);
	assert.equal(updatedRow.updated_at, persisted.updated_at);
	assert.deepEqual(updatedRow.avatar, Buffer.from(avatar, 'base64'));
	assert.equal(Object.hasOwn(persisted, 'password_hash'), false);
	const bob = await (
		await request('/api/me?include=avatar', { cookie: otherCookie })
	).json();
	assert.equal(bob.avatar, null);
	assert.equal(bob.display_name, null);
	for (const body of [
		{},
		{ theme: 'light', language: 'invalid' },
		{ theme: 'light', avatar: 'not base64' },
		{ display_name: 'x'.repeat(33), theme: 'light' },
		{ theme: 'light', id: bob.id },
		{
			avatar: sizedPng(MAX_AVATAR_BYTES + 1).toString('base64'),
			language: 'en',
		},
	]) {
		assert.equal(
			(await request('/api/me', { cookie, method: 'PATCH', body })).status,
			400,
		);
		assert.deepEqual(await get('?include=avatar'), persisted);
	}
	assert.equal(
		(await request('/api/me', { cookie, method: 'PATCH', raw: '{broken' }))
			.status,
		400,
	);
	assert.equal(
		(
			await request('/api/me', {
				cookie,
				method: 'PATCH',
				body: { avatar: 'A'.repeat(1024 * 1024) },
			})
		).status,
		413,
	);
	assert.deepEqual(await get('?include=avatar'), persisted);
	const partial = await request('/api/me', {
		cookie,
		method: 'PATCH',
		body: { language: 'zh' },
	});
	assert.equal(partial.status, 200);
	const afterPartial = await get('?include=avatar');
	assert.equal(afterPartial.language, 'zh');
	assert.equal(afterPartial.avatar, avatar);
	assert.equal(afterPartial.display_name, persisted.display_name);
	assert.equal(afterPartial.theme, 'dark');
	const cleared = await request('/api/me', {
		cookie,
		method: 'PATCH',
		body: { display_name: null, avatar: null, language: null, theme: null },
	});
	assert.equal(cleared.status, 200);
	const final = await get('?include=avatar');
	for (const key of ['display_name', 'avatar', 'language', 'theme'])
		assert.equal(final[key], null);
	assert.equal(final.username, 'alice');
	assert.deepEqual(final.rooms, initial.rooms);
});
