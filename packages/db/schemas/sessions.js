import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './users.js';

export const sessions = sqliteTable('sessions', {
	sid: text('sid'),
	user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	created_at: integer('created_at').notNull(),
	expires_at: integer('expires_at').notNull(),
}, (table) => [
	// Table-level primary key preserves SQLite's nullable TEXT PRIMARY KEY behavior.
	primaryKey({ columns: [table.sid] }),
	index('idx_sessions_expires').on(table.expires_at),
]);
