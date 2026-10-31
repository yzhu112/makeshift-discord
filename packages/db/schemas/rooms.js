import { sql } from 'drizzle-orm';
import { check, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const rooms = sqliteTable('rooms', {
	name: text('name'),
	code: text('code'),
	created_at: integer('created_at').notNull(),
}, (table) => [
	// Table-level primary key preserves SQLite's nullable TEXT PRIMARY KEY behavior.
	primaryKey({ columns: [table.name] }),
	check('rooms_code_check', sql`${table.code} IS NULL OR (length(${table.code}) = 8)`),
]);
