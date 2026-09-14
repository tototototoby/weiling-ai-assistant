CREATE TABLE `bot_wecom_bindings` (
	`bot_instance_id` text PRIMARY KEY NOT NULL,
	`employee_id` text,
	`wecom_user_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`preferred_for_proactive` integer DEFAULT true NOT NULL,
	`last_inbound_at` integer,
	`last_outbound_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bot_instance_id`) REFERENCES `bot_instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employee_directory_entries`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `bot_wecom_bindings` (
	`bot_instance_id`,
	`employee_id`,
	`wecom_user_id`,
	`enabled`,
	`preferred_for_proactive`,
	`last_inbound_at`,
	`last_outbound_at`,
	`last_error`,
	`created_at`,
	`updated_at`
)
SELECT
	`employee_directory_entries`.`claimed_bot_instance_id`,
	`employee_wecom_bindings`.`employee_id`,
	`employee_wecom_bindings`.`wecom_user_id`,
	`employee_wecom_bindings`.`enabled`,
	`employee_wecom_bindings`.`preferred_for_proactive`,
	`employee_wecom_bindings`.`last_inbound_at`,
	`employee_wecom_bindings`.`last_outbound_at`,
	`employee_wecom_bindings`.`last_error`,
	`employee_wecom_bindings`.`created_at`,
	`employee_wecom_bindings`.`updated_at`
FROM `employee_wecom_bindings`
INNER JOIN `employee_directory_entries`
	ON `employee_directory_entries`.`id` = `employee_wecom_bindings`.`employee_id`
INNER JOIN `bot_instances`
	ON `bot_instances`.`id` = `employee_directory_entries`.`claimed_bot_instance_id`;
--> statement-breakpoint
CREATE UNIQUE INDEX `bot_wecom_bindings_user_id_idx` ON `bot_wecom_bindings` (`wecom_user_id`);
--> statement-breakpoint
CREATE INDEX `bot_wecom_bindings_enabled_idx` ON `bot_wecom_bindings` (`enabled`);
--> statement-breakpoint
CREATE INDEX `bot_wecom_bindings_employee_idx` ON `bot_wecom_bindings` (`employee_id`);
--> statement-breakpoint
CREATE TABLE `__new_wecom_message_receipts` (
	`message_id` text PRIMARY KEY NOT NULL,
	`bot_instance_id` text NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`error` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`received_at` integer NOT NULL,
	`completed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bot_instance_id`) REFERENCES `bot_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_wecom_message_receipts` (
	`message_id`,
	`bot_instance_id`,
	`status`,
	`error`,
	`attempt_count`,
	`received_at`,
	`completed_at`,
	`updated_at`
)
SELECT
	`wecom_message_receipts`.`message_id`,
	`wecom_message_receipts`.`bot_instance_id`,
	`wecom_message_receipts`.`status`,
	`wecom_message_receipts`.`error`,
	`wecom_message_receipts`.`attempt_count`,
	`wecom_message_receipts`.`received_at`,
	`wecom_message_receipts`.`completed_at`,
	`wecom_message_receipts`.`updated_at`
FROM `wecom_message_receipts`
INNER JOIN `bot_instances`
	ON `bot_instances`.`id` = `wecom_message_receipts`.`bot_instance_id`;
--> statement-breakpoint
DROP TABLE `wecom_message_receipts`;
--> statement-breakpoint
ALTER TABLE `__new_wecom_message_receipts` RENAME TO `wecom_message_receipts`;
--> statement-breakpoint
CREATE INDEX `wecom_message_receipts_bot_received_idx` ON `wecom_message_receipts` (`bot_instance_id`,`received_at`);
--> statement-breakpoint
CREATE TABLE `__new_wecom_proactive_deliveries` (
	`delivery_id` text PRIMARY KEY NOT NULL,
	`semantic_key` text NOT NULL,
	`bot_instance_id` text NOT NULL,
	`status` text DEFAULT 'delivering' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`sent_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bot_instance_id`) REFERENCES `bot_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_wecom_proactive_deliveries` (
	`delivery_id`,
	`semantic_key`,
	`bot_instance_id`,
	`status`,
	`attempt_count`,
	`last_error`,
	`sent_at`,
	`created_at`,
	`updated_at`
)
SELECT
	`wecom_proactive_deliveries`.`delivery_id`,
	`wecom_proactive_deliveries`.`semantic_key`,
	`wecom_proactive_deliveries`.`bot_instance_id`,
	`wecom_proactive_deliveries`.`status`,
	`wecom_proactive_deliveries`.`attempt_count`,
	`wecom_proactive_deliveries`.`last_error`,
	`wecom_proactive_deliveries`.`sent_at`,
	`wecom_proactive_deliveries`.`created_at`,
	`wecom_proactive_deliveries`.`updated_at`
FROM `wecom_proactive_deliveries`
INNER JOIN `bot_instances`
	ON `bot_instances`.`id` = `wecom_proactive_deliveries`.`bot_instance_id`;
--> statement-breakpoint
DROP TABLE `wecom_proactive_deliveries`;
--> statement-breakpoint
ALTER TABLE `__new_wecom_proactive_deliveries` RENAME TO `wecom_proactive_deliveries`;
--> statement-breakpoint
CREATE UNIQUE INDEX `wecom_proactive_deliveries_semantic_key_idx` ON `wecom_proactive_deliveries` (`semantic_key`);
--> statement-breakpoint
CREATE INDEX `wecom_proactive_deliveries_status_updated_idx` ON `wecom_proactive_deliveries` (`status`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `wecom_proactive_deliveries_bot_created_idx` ON `wecom_proactive_deliveries` (`bot_instance_id`,`created_at`);
--> statement-breakpoint
DROP TABLE `employee_wecom_bindings`;
