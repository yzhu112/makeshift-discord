import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'drizzle-kit';

const packageDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
	dialect: 'sqlite',
	schema: resolve(packageDir, 'schemas/diagnostics/*.js'),
	out: resolve(packageDir, 'migrations/diagnostics'),
	dbCredentials: {
		// Relative overrides are resolved from packages/db, just like the default.
		url: resolve(packageDir, process.env.DIAGNOSTICS_DB_PATH ?? '../../backend/data/preview-diagnostics.db'),
	},
});
