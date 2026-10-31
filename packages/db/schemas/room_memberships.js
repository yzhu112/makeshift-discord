import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { rooms } from './rooms.js';
import { users } from './users.js';

export const room_memberships = sqliteTable('room_memberships', {
	user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	room_name: text('room_name').notNull().references(() => rooms.name, { onDelete: 'cascade' }),
	joined_at: integer('joined_at').notNull(),
}, (table) => [
	primaryKey({ columns: [table.user_id, table.room_name] }),
	index('idx_memberships_room').on(table.room_name),
]);
