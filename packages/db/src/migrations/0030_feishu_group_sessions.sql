ALTER TABLE `bot_feishu_configs` ADD `owner_open_id` text;
--> statement-breakpoint
CREATE TABLE `bot_feishu_group_sessions` (
	`bot_instance_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`session_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY (`bot_instance_id`,`chat_id`),
	FOREIGN KEY (`bot_instance_id`) REFERENCES `bot_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
