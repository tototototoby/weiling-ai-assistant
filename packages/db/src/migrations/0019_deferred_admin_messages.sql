CREATE TABLE `global_admin_message_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`defer_failed_until_user_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `global_admin_message_configs` (`id`, `defer_failed_until_user_active`, `created_at`, `updated_at`)
VALUES ('global', true, unixepoch() * 1000, unixepoch() * 1000);
--> statement-breakpoint
CREATE INDEX `admin_message_deliveries_waiting_bot_idx` ON `admin_message_deliveries` (`status`,`bot_instance_id`,`created_at`);
