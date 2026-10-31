import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

export function migrateMain(sqlite) {
	// A converted backup already contains this migration's hash and timestamp.
	// Do not silently baseline an unconverted database and skip schema changes.
	const tables = new Set(
		sqlite
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
			.all()
			.map((row) => row.name),
	);
	if (tables.has('users') && !tables.has('__drizzle_migrations')) {
		throw new Error(
			'This database still uses the old SQL migrations. Restore the converted Drizzle database, or use db:seed --fresh only for a disposable local database.',
		);
	}
	migrate(drizzle(sqlite), {
		migrationsFolder: fileURLToPath(
			new URL('./migrations/main', import.meta.url),
		),
	});
}

export function migrateDiagnostics(sqlite) {
	// The initial migration also adopts the unchanged legacy diagnostics tables.
	migrate(drizzle(sqlite), {
		migrationsFolder: fileURLToPath(
			new URL('./migrations/diagnostics', import.meta.url),
		),
	});
}
