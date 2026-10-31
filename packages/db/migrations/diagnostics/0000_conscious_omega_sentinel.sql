CREATE TABLE IF NOT EXISTS `calls` (
	`id` text PRIMARY KEY,
	`room_name` text NOT NULL,
	`server_instance_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`end_reason` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `calls_room_time` ON `calls` (`room_name`,`started_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `events` (
	`id` integer PRIMARY KEY NOT NULL,
	`call_id` text,
	`participant_session_id` text,
	`room_name` text,
	`source` text NOT NULL,
	`source_event_id` text,
	`occurred_at` integer NOT NULL,
	`received_at` integer NOT NULL,
	`level` text NOT NULL,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`details` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`call_id`) REFERENCES `calls`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`participant_session_id`) REFERENCES `participant_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `events_session_time` ON `events` (`participant_session_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `events_call_id` ON `events` (`call_id`,`id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `events_time` ON `events` (`occurred_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `events_source_source_event_id_unique` ON `events` (`source`,`source_event_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `metadata` (
	`key` text PRIMARY KEY,
	`value` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `participant_samples` (
	`id` integer PRIMARY KEY NOT NULL,
	`participant_session_id` text NOT NULL,
	`sequence_number` integer NOT NULL,
	`sampled_at` integer NOT NULL,
	`received_at` integer NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`participant_session_id`) REFERENCES `participant_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `samples_time` ON `participant_samples` (`sampled_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `samples_session_time` ON `participant_samples` (`participant_session_id`,`sampled_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `participant_samples_participant_session_id_sequence_number_unique` ON `participant_samples` (`participant_session_id`,`sequence_number`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `participant_sessions` (
	`id` text PRIMARY KEY,
	`call_id` text,
	`room_name` text NOT NULL,
	`user_id` integer,
	`username` text NOT NULL,
	`livekit_room_sid` text,
	`livekit_participant_sid` text,
	`attempted_at` integer NOT NULL,
	`connected_at` integer,
	`ended_at` integer,
	`last_seen_at` integer NOT NULL,
	`status` text DEFAULT 'joining' NOT NULL,
	`end_reason` text,
	`client_info` text DEFAULT '{}' NOT NULL,
	`last_sequence` integer DEFAULT -1 NOT NULL,
	FOREIGN KEY (`call_id`) REFERENCES `calls`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sessions_call` ON `participant_sessions` (`call_id`,`attempted_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sessions_sid` ON `participant_sessions` (`livekit_participant_sid`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `server_samples` (
	`id` integer PRIMARY KEY NOT NULL,
	`server_instance_id` text NOT NULL,
	`sampled_at` integer NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `server_time` ON `server_samples` (`sampled_at`);