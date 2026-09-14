CREATE TABLE `bot_morning_briefing_policies` (
	`bot_instance_id` text PRIMARY KEY NOT NULL,
	`admin_enabled` integer DEFAULT true NOT NULL,
	`location` text DEFAULT '北京' NOT NULL,
	`delivery_time` text DEFAULT '08:30' NOT NULL,
	`timezone` text DEFAULT 'Asia/Shanghai' NOT NULL,
	`force_enabled` integer DEFAULT false NOT NULL,
	`observed_user_opt_out` integer DEFAULT false NOT NULL,
	`desired_revision` integer DEFAULT 1 NOT NULL,
	`applied_revision` integer DEFAULT 0 NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`last_sync_error` text,
	`last_synced_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bot_instance_id`) REFERENCES `bot_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
