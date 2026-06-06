import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import CONFIG from './config.js';
import { logger } from './logger.js';

const dbPath = resolve(CONFIG.DB_PATH ?? './data/voicechat.db');
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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

export { db };
