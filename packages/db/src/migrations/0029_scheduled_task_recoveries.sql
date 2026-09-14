CREATE TABLE `scheduled_task_recoveries` (
	`recovery_id` text PRIMARY KEY NOT NULL,
	`bot_instance_id` text NOT NULL,
	`task_id` text NOT NULL,
	`kind` text DEFAULT 'missed_one_shot' NOT NULL,
	`scheduled_for` integer,
	`prompt` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`error` text,
	`delivered_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bot_instance_id`) REFERENCES `bot_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scheduled_task_recoveries_bot_status_idx` ON `scheduled_task_recoveries` (`bot_instance_id`,`status`);
