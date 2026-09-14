ALTER TABLE `employee_directory_entries` ADD COLUMN `claimed_bot_instance_id` text;
--> statement-breakpoint
CREATE INDEX `employee_directory_claimed_bot_idx` ON `employee_directory_entries` (`claimed_bot_instance_id`);
