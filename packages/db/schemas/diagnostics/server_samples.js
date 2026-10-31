import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const server_samples = sqliteTable('server_samples', {
	id: integer('id').primaryKey(),
	server_instance_id: text('server_instance_id').notNull(),
	sampled_at: integer('sampled_at').notNull(),
	data: text('data').notNull(),
}, (table) => [
	index('server_time').on(table.sampled_at),
]);
