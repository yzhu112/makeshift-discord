import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import CONFIG from '#config';
import { logger } from '#logger';

// Does not expire by default
const DEFAULT_EXPIRY_DATE = 0;

const dbPath = CONFIG.DB_PATH;
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function runMigrations() {
  db.exec(
    'CREATE TABLE IF NOT EXISTS migrations (filename TEXT PRIMARY KEY, applied_at INTEGER)',
  );

  const migrationsDir = resolve('./migrations');
  const applied = new Set(
    db
      .prepare('SELECT filename FROM migrations')
      .all()
      .map((row) => row.filename),
  );
  const pending = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => !applied.has(f));

  const recordMigration = db.prepare(
    'INSERT INTO migrations (filename, applied_at) VALUES (?, ?)',
  );

  for (const file of pending) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const run = db.transaction(() => {
      db.exec(sql);
      recordMigration.run(file, Date.now());
    });
    run();
    logger.info({ migration: file }, 'applied migration');
  }
}

// ------------------------------------ Session ------------------------------------

function getSessionBySid(sid) {
  return db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE sid = ?')
    .get(sid);
}

function createSession(sid, user_id) {
  const insert = db.prepare(
    'INSERT INTO sessions (sid, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  );
  insert.run(sid, user_id, Date.now(), DEFAULT_EXPIRY_DATE);
}

function destroySession(sid) {
  db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
}

function sweepStaleSessions() {
  db.prepare(
    'DELETE FROM sessions WHERE expires_at > 0 AND expires_at < ?',
  ).run(Date.now());
}

// ------------------------------------ User ------------------------------------

function createUser(username, passwordHash) {
  const { lastInsertRowid: id } = db
    .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(username, passwordHash, Date.now());
  return { id, username };
}

function getUserByUsername(username) {
  return db
    .prepare('SELECT id, password_hash FROM users WHERE username = ?')
    .get(username);
}

export default {
  runMigrations,
  getSessionBySid,
  createSession,
  destroySession,
  sweepStaleSessions,
  createUser,
  getUserByUsername
};
