CREATE TABLE `web_chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_instance_id` text NOT NULL,
	`owner_user_id` text,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`tool_events_json` text,
	`request_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bot_instance_id`) REFERENCES `bot_instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `web_chat_messages_bot_created_idx` ON `web_chat_messages` (`bot_instance_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `web_chat_messages_request_id_idx` ON `web_chat_messages` (`request_id`);