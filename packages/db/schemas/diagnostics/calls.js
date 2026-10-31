import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const calls = sqliteTable('calls', {
	id: text('id'),
	room_name: text('room_name').notNull(),
	server_instance_id: text('server_instance_id'),
	started_at: integer('started_at').notNull(),
	ended_at: integer('ended_at'),
	end_reason: text('end_reason'),
}, (table) => [
	// Table-level primary key preserves SQLite's nullable TEXT PRIMARY KEY behavior.
	primaryKey({ columns: [table.id] }),
	index('calls_room_time').on(table.room_name, table.started_at),
]);
