CREATE TABLE `wecom_onboarding_receipts` (
	`message_id` text PRIMARY KEY NOT NULL,
	`wecom_user_id` text NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`error` text,
	`response` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`received_at` integer NOT NULL,
	`completed_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wecom_onboarding_receipts_user_received_idx` ON `wecom_onboarding_receipts` (`wecom_user_id`,`received_at`);
--> statement-breakpoint
CREATE TABLE `wecom_onboarding_sessions` (
	`wecom_user_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'awaiting_name' NOT NULL,
	`employee_id` text,
	`bot_instance_id` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`last_prompt_at` integer NOT NULL,
	`cooldown_until` integer,
	`expires_at` integer NOT NULL,
	`bound_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employee_directory_entries`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`bot_instance_id`) REFERENCES `bot_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wecom_onboarding_sessions_bot_idx` ON `wecom_onboarding_sessions` (`bot_instance_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `wecom_onboarding_sessions_employee_idx` ON `wecom_onboarding_sessions` (`employee_id`);
--> statement-breakpoint
CREATE INDEX `wecom_onboarding_sessions_status_updated_idx` ON `wecom_onboarding_sessions` (`status`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `wecom_onboarding_sessions_cooldown_idx` ON `wecom_onboarding_sessions` (`cooldown_until`);
