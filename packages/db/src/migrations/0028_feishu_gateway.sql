CREATE TABLE `bot_feishu_configs` (
	`bot_instance_id` text PRIMARY KEY NOT NULL,
	`app_id` text DEFAULT '' NOT NULL,
	`app_secret` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`event_status` text DEFAULT 'not_configured' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`observed_revision` integer,
	`last_connected_at` integer,
	`last_disconnected_at` integer,
	`last_inbound_at` integer,
	`last_outbound_at` integer,
	`last_error` text,
	`updated_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bot_instance_id`) REFERENCES `bot_instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `bot_feishu_configs_enabled_idx` ON `bot_feishu_configs` (`enabled`);
--> statement-breakpoint
CREATE TABLE `bot_feishu_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`bot_instance_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`sender_open_id` text NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`error` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`received_at` integer NOT NULL,
	`completed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bot_instance_id`) REFERENCES `bot_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bot_feishu_events_bot_received_idx` ON `bot_feishu_events` (`bot_instance_id`,`received_at`);
