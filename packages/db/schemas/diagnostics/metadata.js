import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const metadata = sqliteTable('metadata', {
	key: text('key'),
	value: text('value'),
}, (table) => [
	// Table-level primary key preserves SQLite's nullable TEXT PRIMARY KEY behavior.
	primaryKey({ columns: [table.key] }),
]);
