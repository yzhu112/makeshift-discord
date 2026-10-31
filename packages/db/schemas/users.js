import { sql } from 'drizzle-orm';
import { blob, check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	username: text('username').unique().notNull(),
	password_hash: text('password_hash').notNull(),
	created_at: integer('created_at').notNull(),
	updated_at: integer('updated_at'),
	display_name: text('display_name'),
	avatar: blob('avatar', { mode: 'buffer' }),
	language: text('language'),
	theme: text('theme'),
}, (table) => [
	check('users_language_check', sql`${table.language} IN ('en', 'zh', 'ja')`),
	check('users_theme_check', sql`${table.theme} IN ('light', 'dark', 'system')`),
]);
