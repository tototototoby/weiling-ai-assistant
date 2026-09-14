CREATE TABLE `employee_invite_links` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employee_invite_links_token_idx` ON `employee_invite_links` (`token`);
--> statement-breakpoint
CREATE INDEX `employee_invite_links_created_at_idx` ON `employee_invite_links` (`created_at` DESC,`id` DESC);
--> statement-breakpoint
CREATE INDEX `employee_invite_links_created_by_idx` ON `employee_invite_links` (`created_by_user_id`);
--> statement-breakpoint
CREATE TABLE `employee_directory_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`legal_name` text,
	`nickname` text,
	`normalized_legal_name` text,
	`normalized_nickname` text,
	`enabled` integer DEFAULT true NOT NULL,
	`reservation_token` text,
	`reserved_at` integer,
	`reservation_invite_id` text,
	`claimed_by_user_id` text,
	`claimed_at` integer,
	`claimed_via_invite_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CHECK (`legal_name` IS NOT NULL OR `nickname` IS NOT NULL),
	FOREIGN KEY (`reservation_invite_id`) REFERENCES `employee_invite_links`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`claimed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`claimed_via_invite_id`) REFERENCES `employee_invite_links`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employee_directory_claimed_user_idx` ON `employee_directory_entries` (`claimed_by_user_id`);
--> statement-breakpoint
CREATE INDEX `employee_directory_created_at_idx` ON `employee_directory_entries` (`created_at` DESC,`id` DESC);
--> statement-breakpoint
CREATE INDEX `employee_directory_legal_name_idx` ON `employee_directory_entries` (`normalized_legal_name`);
--> statement-breakpoint
CREATE INDEX `employee_directory_nickname_idx` ON `employee_directory_entries` (`normalized_nickname`);
--> statement-breakpoint
CREATE UNIQUE INDEX `employee_directory_reservation_token_idx` ON `employee_directory_entries` (`reservation_token`);
--> statement-breakpoint
CREATE TABLE `registration_onboarding_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`default_llm_profile_id` text,
	`updated_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`default_llm_profile_id`) REFERENCES `user_llm_profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
