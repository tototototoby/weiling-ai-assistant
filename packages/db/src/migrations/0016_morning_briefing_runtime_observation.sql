ALTER TABLE `bot_morning_briefing_policies` ADD `runtime_schedule_task_id` text;
--> statement-breakpoint
ALTER TABLE `bot_morning_briefing_policies` ADD `runtime_scheduled_for` text;
--> statement-breakpoint
ALTER TABLE `bot_morning_briefing_policies` ADD `runtime_needs_schedule` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `bot_morning_briefing_policies` ADD `runtime_needs_cleanup` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `bot_morning_briefing_policies` ADD `runtime_observed_at` integer;
