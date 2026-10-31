import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { and, eq, gt, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrateMain } from '../migrate.js';
import { room_memberships } from '../schemas/room_memberships.js';
import { rooms } from '../schemas/rooms.js';
import { sessions } from '../schemas/sessions.js';
import { users } from '../schemas/users.js';

export function createMainDbService(path) {
	mkdirSync(dirname(path), { recursive: true });
	const sqlite = new Database(path);
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('foreign_keys = ON');
	const db = drizzle(sqlite);

	function runMigrations() {
		migrateMain(sqlite);
	}

	function getSessionBySid(sid) {
		return db
			.select({ user_id: sessions.user_id, expires_at: sessions.expires_at })
			.from(sessions)
			.where(eq(sessions.sid, sid))
			.get();
	}

	function createSession(sid, user_id) {
		db.insert(sessions)
			.values({ sid, user_id, created_at: Date.now(), expires_at: 0 })
			.run();
	}

	function destroySession(sid) {
		db.delete(sessions).where(eq(sessions.sid, sid)).run();
	}

	function sweepStaleSessions() {
		db.delete(sessions)
			.where(
				and(gt(sessions.expires_at, 0), lt(sessions.expires_at, Date.now())),
			)
			.run();
	}

	function createUser(username, passwordHash) {
		const now = Date.now();
		return db
			.insert(users)
			.values({
				username,
				password_hash: passwordHash,
				created_at: now,
				updated_at: now,
			})
			.returning({ id: users.id, username: users.username })
			.get();
	}

	function getUserByUsername(username) {
		return db
			.select({ id: users.id, password_hash: users.password_hash })
			.from(users)
			.where(eq(users.username, username))
			.get();
	}

	function getUserById(id) {
		return db
			.select({ id: users.id, username: users.username })
			.from(users)
			.where(eq(users.id, id))
			.get();
	}

	function createRoom(roomName, code) {
		db.insert(rooms)
			.values({ name: roomName, code, created_at: Date.now() })
			.run();
	}

	function getRoomCode(roomName) {
		return db
			.select({ name: rooms.name, code: rooms.code })
			.from(rooms)
			.where(eq(rooms.name, roomName))
			.get();
	}

	function joinRoom(userId, roomName) {
		db.insert(room_memberships)
			.values({ room_name: roomName, user_id: userId, joined_at: Date.now() })
			.run();
	}

	function getRoomMemberships(userId) {
		return db
			.select({ name: rooms.name, code: rooms.code })
			.from(room_memberships)
			.innerJoin(rooms, eq(rooms.name, room_memberships.room_name))
			.where(eq(room_memberships.user_id, userId))
			.all();
	}

	function seedRooms(names) {
		for (const name of names) {
			db.insert(rooms)
				.values({ name, code: null, created_at: Date.now() })
				.onConflictDoNothing({ target: rooms.name })
				.run();
		}
	}

	return {
		runMigrations,
		seedRooms,
		close: () => sqlite.close(),
		getSessionBySid,
		createSession,
		destroySession,
		sweepStaleSessions,
		createUser,
		getUserByUsername,
		getUserById,
		createRoom,
		getRoomCode,
		joinRoom,
		getRoomMemberships,
	};
}
