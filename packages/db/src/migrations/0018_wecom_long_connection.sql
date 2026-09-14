CREATE TABLE `global_wecom_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`bot_id` text DEFAULT '' NOT NULL,
	`secret` text DEFAULT '' NOT NULL,
	`ws_url` text DEFAULT 'wss://openws.work.weixin.qq.com' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`connection_status` text DEFAULT 'disabled' NOT NULL,
	`observed_revision` integer,
	`last_connected_at` integer,
	`last_disconnected_at` integer,
	`last_error` text,
	`updated_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `employee_wecom_bindings` (
	`employee_id` text PRIMARY KEY NOT NULL,
	`wecom_user_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`preferred_for_proactive` integer DEFAULT true NOT NULL,
	`last_inbound_at` integer,
	`last_outbound_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employee_directory_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employee_wecom_bindings_user_id_idx` ON `employee_wecom_bindings` (`wecom_user_id`);
--> statement-breakpoint
CREATE INDEX `employee_wecom_bindings_enabled_idx` ON `employee_wecom_bindings` (`enabled`);
--> statement-breakpoint
CREATE TABLE `wecom_message_receipts` (
	`message_id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`bot_instance_id` text NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`error` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`received_at` integer NOT NULL,
	`completed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employee_directory_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wecom_message_receipts_bot_received_idx` ON `wecom_message_receipts` (`bot_instance_id`,`received_at`);
--> statement-breakpoint
CREATE TABLE `wecom_proactive_deliveries` (
	`delivery_id` text PRIMARY KEY NOT NULL,
	`semantic_key` text NOT NULL,
	`employee_id` text NOT NULL,
	`bot_instance_id` text NOT NULL,
	`status` text DEFAULT 'delivering' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`sent_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employee_directory_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wecom_proactive_deliveries_semantic_key_idx` ON `wecom_proactive_deliveries` (`semantic_key`);
--> statement-breakpoint
CREATE INDEX `wecom_proactive_deliveries_status_updated_idx` ON `wecom_proactive_deliveries` (`status`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `wecom_proactive_deliveries_bot_created_idx` ON `wecom_proactive_deliveries` (`bot_instance_id`,`created_at`);
