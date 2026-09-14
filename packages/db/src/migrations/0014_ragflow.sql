CREATE TABLE `global_ragflow_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`api_base_url` text DEFAULT '' NOT NULL,
	`api_key` text DEFAULT '' NOT NULL,
	`knowledge_base_name` text DEFAULT '公司 RAGFlow 知识库' NOT NULL,
	`dataset_ids_json` text DEFAULT '[]' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`last_test_status` text DEFAULT 'untested' NOT NULL,
	`last_test_error` text,
	`last_tested_at` integer,
	`updated_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `bot_ragflow_sync_states` (
	`bot_instance_id` text PRIMARY KEY NOT NULL,
	`applied_revision` integer DEFAULT 0 NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`last_sync_error` text,
	`last_synced_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bot_instance_id`) REFERENCES `bot_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
