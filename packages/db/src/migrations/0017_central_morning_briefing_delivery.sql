ALTER TABLE `bot_morning_briefing_policies` ADD `central_scheduled_for` text;
--> statement-breakpoint
ALTER TABLE `bot_morning_briefing_policies` ADD `central_last_delivery_date` text;
--> statement-breakpoint
ALTER TABLE `bot_morning_briefing_policies` ADD `central_last_delivered_at` integer;
--> statement-breakpoint
ALTER TABLE `bot_morning_briefing_policies` ADD `central_last_error` text;
