import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'drizzle-kit';

const packageDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
	dialect: 'sqlite',
	// Match only main tables; diagnostics has its own database and migrations.
	schema: resolve(packageDir, 'schemas/*.js'),
	out: resolve(packageDir, 'migrations/main'),
	dbCredentials: {
		// Relative overrides are resolved from packages/db, just like the default.
		url: resolve(packageDir, process.env.DB_PATH ?? '../../backend/data/preview.db'),
	},
});
