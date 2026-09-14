ALTER TABLE `employee_directory_entries` ADD `company_email` text;
--> statement-breakpoint
CREATE INDEX `employee_directory_company_email_idx` ON `employee_directory_entries` (`company_email`);
--> statement-breakpoint
CREATE TABLE `global_email_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`smtp_host` text DEFAULT 'smtp.exmail.qq.com' NOT NULL,
	`smtp_port` integer DEFAULT 465 NOT NULL,
	`smtp_security` text DEFAULT 'ssl' NOT NULL,
	`sender_email` text,
	`sender_name` text DEFAULT '微Link · 微灵 AI 助手' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`observed_revision` integer,
	`updated_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `email_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`semantic_key` text NOT NULL,
	`source` text NOT NULL,
	`bot_instance_id` text NOT NULL,
	`recipient_user_id` text,
	`recipient_email` text NOT NULL,
	`created_by_user_id` text,
	`subject` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text,
	`sent_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bot_instance_id`) REFERENCES `bot_instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_deliveries_semantic_key_idx` ON `email_deliveries` (`semantic_key`);
--> statement-breakpoint
CREATE INDEX `email_deliveries_ready_idx` ON `email_deliveries` (`status`,`next_attempt_at`,`created_at`);
--> statement-breakpoint
CREATE INDEX `email_deliveries_bot_idx` ON `email_deliveries` (`bot_instance_id`,`created_at` DESC);
--> statement-breakpoint
CREATE INDEX `email_deliveries_source_idx` ON `email_deliveries` (`source`,`created_at` DESC);
