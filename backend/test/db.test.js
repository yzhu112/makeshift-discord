import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createMainDbService } from '@voice/db';
import { migrateDiagnostics, migrateMain } from '@voice/db/migrate';
import Database from 'better-sqlite3';

const directory = mkdtempSync(join(tmpdir(), 'voice-db-test-'));
process.env.DB_PATH = join(directory, 'main.db');
const { default: service } = await import('../src/db.js');

test('Drizzle migrations, backend query contracts, and repeated seeding', () => {
	service.runMigrations();
	const user = service.createUser('test-user', 'test-hash');
	assert.deepEqual(service.getUserById(user.id), user);
	assert.deepEqual(service.getUserByUsername(user.username), {
		id: user.id,
		password_hash: 'test-hash',
	});
	assert.equal(service.getUserById(-1), undefined);
	assert.throws(() => service.createUser('test-user', 'other'), {
		code: 'SQLITE_CONSTRAINT_UNIQUE',
	});
	service.createRoom('home', '12345678');
	assert.throws(() => service.createRoom('invalid', 'short'), {
		code: 'SQLITE_CONSTRAINT_CHECK',
	});
	service.joinRoom(user.id, 'home');
	assert.deepEqual(service.getRoomMemberships(user.id), [
		{ name: 'home', code: '12345678' },
	]);
	assert.deepEqual(service.getRoomCode('home'), {
		name: 'home',
		code: '12345678',
	});
	assert.throws(() => service.joinRoom(user.id, 'missing'), {
		code: 'SQLITE_CONSTRAINT_FOREIGNKEY',
	});
	service.createSession('session', user.id);
	assert.deepEqual(service.getSessionBySid('session'), {
		user_id: user.id,
		expires_at: 0,
	});
	const sqlite = new Database(process.env.DB_PATH);
	try {
		sqlite
			.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)')
			.run('expired', user.id, 1, 2);
		service.sweepStaleSessions();
		assert.equal(service.getSessionBySid('expired'), undefined);
		assert.ok(service.getSessionBySid('session'));
		service.destroySession('session');
		assert.equal(service.getSessionBySid('session'), undefined);
		service.runMigrations();
		assert.equal(
			sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get().n,
			2,
		);
		for (let i = 0; i < 2; i++) {
			const result = spawnSync(process.execPath, ['backend/seed/seed.js'], {
				cwd: new URL('../../', import.meta.url),
				encoding: 'utf8',
				env: {
					...process.env,
					INVITE_CODES: '{"test":"home","other":"new-room"}',
				},
			});
			assert.equal(result.status, 0, result.stderr);
		}
		assert.equal(service.getRoomCode('home').code, '12345678');
		assert.ok(service.getRoomCode('new-room'));
		assert.equal(sqlite.prepare('SELECT count(*) AS n FROM users').get().n, 1);
		assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
	} finally {
		sqlite.close();
		service.close();
		rmSync(directory, { recursive: true, force: true });
	}
});

test('unconverted databases fail without altering their data', () => {
	const sqlite = new Database(':memory:');
	try {
		sqlite.exec(
			'CREATE TABLE users (id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1)',
		);
		assert.throws(() => migrateMain(sqlite), /Restore the converted/);
		assert.deepEqual(sqlite.prepare('SELECT * FROM users').all(), [{ id: 1 }]);
	} finally {
		sqlite.close();
	}
});

test('diagnostics adopts existing tables and preserves history across restarts', () => {
	const sqlite = new Database(':memory:');
	try {
		migrateDiagnostics(sqlite);
		sqlite.exec(
			"INSERT INTO calls (id, room_name, started_at) VALUES ('old-call', 'home', 100)",
		);
		// Simulate the pre-Drizzle store: same tables, no migration journal.
		sqlite.exec('DROP TABLE __drizzle_migrations');
		migrateDiagnostics(sqlite);
		migrateDiagnostics(sqlite);
		assert.equal(sqlite.prepare('SELECT id FROM calls').get().id, 'old-call');
		assert.equal(
			sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get().n,
			1,
		);
	} finally {
		sqlite.close();
	}
});

test('database services own independent connections without exposing a driver', () => {
	const first = createMainDbService(':memory:');
	const second = createMainDbService(':memory:');
	try {
		first.runMigrations();
		second.runMigrations();
		first.createUser('isolated', 'hash');
		assert.equal(second.getUserByUsername('isolated'), undefined);
		assert.equal(first.db, undefined);
		assert.equal(first.prepare, undefined);
	} finally {
		first.close();
		second.close();
	}
});
