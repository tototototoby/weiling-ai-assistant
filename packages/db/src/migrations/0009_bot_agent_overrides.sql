ALTER TABLE `bot_agent_config_sync_states`
ADD `applied_override_revision` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `bot_agent_config_overrides` (
	`bot_instance_id` text PRIMARY KEY NOT NULL,
	`agents_appendix` text DEFAULT '' NOT NULL,
	`soul_appendix` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`change_reason` text NOT NULL,
	`updated_by_email` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bot_instance_id`) REFERENCES `bot_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bot_agent_config_override_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_instance_id` text NOT NULL,
	`revision` integer NOT NULL,
	`agents_appendix` text NOT NULL,
	`soul_appendix` text NOT NULL,
	`change_reason` text NOT NULL,
	`updated_by_email` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`bot_instance_id`) REFERENCES `bot_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bot_agent_override_bot_revision_idx`
ON `bot_agent_config_override_revisions` (`bot_instance_id`,`revision`);
--> statement-breakpoint
CREATE INDEX `bot_agent_override_bot_created_at_idx`
ON `bot_agent_config_override_revisions` (`bot_instance_id`,`created_at`);
