CREATE TABLE `room_memberships` (
	`user_id` integer NOT NULL,
	`room_name` text NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `room_name`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_name`) REFERENCES `rooms`(`name`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_memberships_room` ON `room_memberships` (`room_name`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`name` text PRIMARY KEY,
	`code` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "rooms_code_check" CHECK("rooms"."code" IS NULL OR (length("rooms"."code") = 8))
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`sid` text PRIMARY KEY,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_expires` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`display_name` text,
	`avatar` blob,
	`language` text,
	`theme` text,
	CONSTRAINT "users_language_check" CHECK("users"."language" IN ('en', 'zh', 'ja')),
	CONSTRAINT "users_theme_check" CHECK("users"."theme" IN ('light', 'dark', 'system'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);