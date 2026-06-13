import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import CONFIG from '#config';

const fresh = process.argv.includes('--fresh');
const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(backendDir, 'migrations');

// --fresh: drop the existing db so we rebuild from nothing.
if (fresh) {
  for (const ext of ['', '-wal', '-shm']) {
    rmSync(`${CONFIG.DB_PATH}${ext}`, { force: true });
  }
  console.log('dropped existing database');
}

mkdirSync(dirname(CONFIG.DB_PATH), { recursive: true });
const db = new Database(CONFIG.DB_PATH);
db.pragma('foreign_keys = ON');

// Apply any pending migrations, recording them the same way the server does
// so server startup won't try to re-run them. No-op if already up to date.
db.exec(
  'CREATE TABLE IF NOT EXISTS migrations (filename TEXT PRIMARY KEY, applied_at INTEGER)',
);
const applied = new Set(
  db
    .prepare('SELECT filename FROM migrations')
    .all()
    .map((row) => row.filename),
);
const record = db.prepare(
  'INSERT INTO migrations (filename, applied_at) VALUES (?, ?)',
);
for (const file of readdirSync(migrationsDir).sort()) {
  if (!file.endsWith('.sql') || applied.has(file)) continue;
  db.transaction(() => {
    db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
    record.run(file, Date.now());
  })();
  console.log(`applied migration: ${file}`);
}

for (const roomName of Object.values(CONFIG.INVITE_CODES)) {
  db.prepare('INSERT OR IGNORE INTO rooms (name, code, created_at) VALUES (?, NULL, ?)')
    .run(roomName, Date.now());
  console.log(`seeded room: ${roomName}`);
}

db.close();
