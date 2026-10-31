import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { participant_sessions } from './participant_sessions.js';

export const participant_samples = sqliteTable('participant_samples', {
	id: integer('id').primaryKey(),
	participant_session_id: text('participant_session_id').notNull().references(() => participant_sessions.id, { onDelete: 'cascade' }),
	sequence_number: integer('sequence_number').notNull(),
	sampled_at: integer('sampled_at').notNull(),
	received_at: integer('received_at').notNull(),
	data: text('data').notNull(),
}, (table) => [
	unique().on(table.participant_session_id, table.sequence_number),
	index('samples_time').on(table.sampled_at),
	index('samples_session_time').on(table.participant_session_id, table.sampled_at),
]);
