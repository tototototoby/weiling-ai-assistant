CREATE TABLE `bot_agent_config_sync_states` (
	`bot_instance_id` text PRIMARY KEY NOT NULL,
	`applied_revision` integer DEFAULT 0 NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`last_sync_error` text,
	`last_synced_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bot_instance_id`) REFERENCES `bot_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `global_agent_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`agents_markdown` text NOT NULL,
	`soul_markdown` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `global_agent_skill_policies` (
	`skill_name` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
