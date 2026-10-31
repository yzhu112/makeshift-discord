import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { calls } from './calls.js';
import { participant_sessions } from './participant_sessions.js';

export const events = sqliteTable('events', {
	id: integer('id').primaryKey(),
	call_id: text('call_id').references(() => calls.id, { onDelete: 'set null' }),
	participant_session_id: text('participant_session_id').references(() => participant_sessions.id, { onDelete: 'set null' }),
	room_name: text('room_name'),
	source: text('source').notNull(),
	source_event_id: text('source_event_id'),
	occurred_at: integer('occurred_at').notNull(),
	received_at: integer('received_at').notNull(),
	level: text('level').notNull(),
	type: text('type').notNull(),
	message: text('message').notNull(),
	details: text('details').notNull().default('{}'),
}, (table) => [
	unique().on(table.source, table.source_event_id),
	index('events_session_time').on(table.participant_session_id, table.occurred_at),
	index('events_call_id').on(table.call_id, table.id),
	index('events_time').on(table.occurred_at),
]);
