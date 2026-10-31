import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { calls } from './calls.js';

export const participant_sessions = sqliteTable('participant_sessions', {
	id: text('id'),
	call_id: text('call_id').references(() => calls.id, { onDelete: 'set null' }),
	room_name: text('room_name').notNull(),
	user_id: integer('user_id'),
	username: text('username').notNull(),
	livekit_room_sid: text('livekit_room_sid'),
	livekit_participant_sid: text('livekit_participant_sid'),
	attempted_at: integer('attempted_at').notNull(),
	connected_at: integer('connected_at'),
	ended_at: integer('ended_at'),
	last_seen_at: integer('last_seen_at').notNull(),
	status: text('status').notNull().default('joining'),
	end_reason: text('end_reason'),
	client_info: text('client_info').notNull().default('{}'),
	last_sequence: integer('last_sequence').notNull().default(-1),
}, (table) => [
	// Table-level primary key preserves SQLite's nullable TEXT PRIMARY KEY behavior.
	primaryKey({ columns: [table.id] }),
	index('sessions_call').on(table.call_id, table.attempted_at),
	index('sessions_sid').on(table.livekit_participant_sid),
]);
