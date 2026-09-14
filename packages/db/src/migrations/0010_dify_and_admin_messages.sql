CREATE TABLE `global_dify_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`api_base_url` text DEFAULT '' NOT NULL,
	`api_key` text DEFAULT '' NOT NULL,
	`app_name` text DEFAULT '公司知识库' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`last_test_status` text DEFAULT 'untested' NOT NULL,
	`last_test_error` text,
	`last_tested_at` integer,
	`updated_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `bot_dify_sync_states` (
	`bot_instance_id` text PRIMARY KEY NOT NULL,
	`applied_revision` integer DEFAULT 0 NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`last_sync_error` text,
	`last_synced_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bot_instance_id`) REFERENCES `bot_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `admin_message_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`bot_instance_id` text NOT NULL,
	`recipient_user_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text,
	`sent_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bot_instance_id`) REFERENCES `bot_instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `admin_message_deliveries_ready_idx` ON `admin_message_deliveries` (`status`,`next_attempt_at`,`created_at`);
--> statement-breakpoint
CREATE INDEX `admin_message_deliveries_batch_idx` ON `admin_message_deliveries` (`batch_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `admin_message_deliveries_bot_idx` ON `admin_message_deliveries` (`bot_instance_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `bot_meal_reminder_preferences` (
	`bot_instance_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'unasked' NOT NULL,
	`city` text DEFAULT '北京' NOT NULL,
	`last_reminder_date` text,
	`last_reminder_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bot_instance_id`) REFERENCES `bot_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bot_dify_conversations` (
	`bot_instance_id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`config_revision` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bot_instance_id`) REFERENCES `bot_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
