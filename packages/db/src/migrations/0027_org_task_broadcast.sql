CREATE TABLE `bot_daily_activity` (
	`bot_instance_id` text NOT NULL,
	`date` text NOT NULL,
	`inbound_count` integer DEFAULT 0 NOT NULL,
	`outbound_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`bot_instance_id`, `date`),
	FOREIGN KEY (`bot_instance_id`) REFERENCES `bot_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `delivery_health_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`check_date` text NOT NULL,
	`summary_json` text DEFAULT '{}' NOT NULL,
	`alert_sent` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_health_checks_date_idx` ON `delivery_health_checks` (`check_date`);--> statement-breakpoint
CREATE INDEX `delivery_health_checks_created_idx` ON `delivery_health_checks` (`created_at`);--> statement-breakpoint
CREATE TABLE `employee_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`leader_employee_id` text,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employee_groups_name_idx` ON `employee_groups` (`name`);--> statement-breakpoint
CREATE INDEX `employee_groups_leader_idx` ON `employee_groups` (`leader_employee_id`);--> statement-breakpoint
CREATE TABLE `global_broadcast_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`authorized_employee_ids_json` text DEFAULT '[]' NOT NULL,
	`rate_limit_minutes` integer DEFAULT 10 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`observed_revision` integer,
	`updated_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `global_delivery_health_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`check_time` text DEFAULT '09:00' NOT NULL,
	`failed_threshold` integer DEFAULT 3 NOT NULL,
	`stuck_hours` integer DEFAULT 24 NOT NULL,
	`alert_email` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`observed_revision` integer,
	`updated_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `global_imagegen_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`endpoint` text DEFAULT '' NOT NULL,
	`api_key` text DEFAULT '' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`observed_revision` integer,
	`updated_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `group_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`assigner_employee_id` text NOT NULL,
	`assignee_employee_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`acceptance_criteria` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`due_at` integer,
	`submitted_at` integer,
	`submitted_summary` text,
	`submitted_evidence_json` text,
	`accepted_at` integer,
	`feedback` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `employee_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigner_employee_id`) REFERENCES `employee_directory_entries`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assignee_employee_id`) REFERENCES `employee_directory_entries`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `group_tasks_group_status_idx` ON `group_tasks` (`group_id`,`status`);--> statement-breakpoint
CREATE INDEX `group_tasks_assignee_status_idx` ON `group_tasks` (`assignee_employee_id`,`status`);--> statement-breakpoint
CREATE INDEX `group_tasks_assigner_status_idx` ON `group_tasks` (`assigner_employee_id`,`status`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_global_admin_message_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`defer_failed_until_user_active` integer DEFAULT true NOT NULL,
	`assistant_name` text DEFAULT '微Link · 微灵 AI 助手' NOT NULL,
	`meal_consent_prompt` text DEFAULT '我是微Link。工作日需要我提醒你点外卖吗？需要的话请回复“开启外卖提醒”，不需要请回复“关闭外卖提醒”。' NOT NULL,
	`meal_rain_reminder` text DEFAULT '我是微Link。今天可能下雨，外卖配送可能会比平时慢，记得现在点外卖。' NOT NULL,
	`meal_standard_reminder` text DEFAULT '我是微Link。该点外卖了，记得安排今天的午餐。' NOT NULL,
	`morning_briefing_intro` text DEFAULT '早上好，我是微Link。今天是 {{date}}。' NOT NULL,
	`processing_ack` text DEFAULT '收到，我是微Link，正在处理，完成后把结果发给你。' NOT NULL,
	`wecom_ack` text DEFAULT '微Link已收到，正在处理，完成后把结果发给你。' NOT NULL,
	`wecom_duplicate` text DEFAULT '微Link已收到这条消息，正在处理中，请稍候。' NOT NULL,
	`wecom_completed` text DEFAULT '微Link已经处理完这条消息，请勿重复发送。' NOT NULL,
	`wecom_failure` text DEFAULT '微Link这次处理没有完成，请稍后重新发送。' NOT NULL,
	`wecom_unsupported` text DEFAULT '我是微Link。当前企业微信通道支持文字和语音转文字，请补充文字说明。' NOT NULL,
	`wecom_group_unsupported` text DEFAULT '我是微Link。当前仅支持员工与机器人单聊。' NOT NULL,
	`wecom_unbound` text DEFAULT '我是微Link。你的企业微信账号尚未绑定员工 Bot，请联系管理员完成绑定。' NOT NULL,
	`wecom_binding_name_prompt` text DEFAULT '我是微Link。为了绑定你已有的员工 Bot，请回复你的姓名或常用称呼。' NOT NULL,
	`wecom_binding_name_invalid` text DEFAULT '我是微Link。暂时无法确认你的员工身份，请核对姓名或常用称呼后重试，或联系管理员。' NOT NULL,
	`wecom_binding_success` text DEFAULT '我是微Link。企业微信已绑定到你的员工 Bot，之后会继续使用同一会话、记忆和工具。' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`observed_revision` integer,
	`updated_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_global_admin_message_configs`("id", "defer_failed_until_user_active", "assistant_name", "meal_consent_prompt", "meal_rain_reminder", "meal_standard_reminder", "morning_briefing_intro", "processing_ack", "wecom_ack", "wecom_duplicate", "wecom_completed", "wecom_failure", "wecom_unsupported", "wecom_group_unsupported", "wecom_unbound", "wecom_binding_name_prompt", "wecom_binding_name_invalid", "wecom_binding_success", "revision", "observed_revision", "updated_by_user_id", "created_at", "updated_at") SELECT "id", "defer_failed_until_user_active", "assistant_name", "meal_consent_prompt", "meal_rain_reminder", "meal_standard_reminder", "morning_briefing_intro", "processing_ack", "wecom_ack", "wecom_duplicate", "wecom_completed", "wecom_failure", "wecom_unsupported", "wecom_group_unsupported", "wecom_unbound", "wecom_binding_name_prompt", "wecom_binding_name_invalid", "wecom_binding_success", "revision", "observed_revision", "updated_by_user_id", "created_at", "updated_at" FROM `global_admin_message_configs`;--> statement-breakpoint
DROP TABLE `global_admin_message_configs`;--> statement-breakpoint
ALTER TABLE `__new_global_admin_message_configs` RENAME TO `global_admin_message_configs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_global_email_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`smtp_host` text DEFAULT 'smtp.exmail.qq.com' NOT NULL,
	`smtp_port` integer DEFAULT 465 NOT NULL,
	`smtp_security` text DEFAULT 'ssl' NOT NULL,
	`sender_email` text,
	`sender_name` text DEFAULT '微Link · 微灵 AI 助手' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`observed_revision` integer,
	`updated_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_global_email_configs`("id", "enabled", "smtp_host", "smtp_port", "smtp_security", "sender_email", "sender_name", "revision", "observed_revision", "updated_by_user_id", "created_at", "updated_at") SELECT "id", "enabled", "smtp_host", "smtp_port", "smtp_security", "sender_email", "sender_name", "revision", "observed_revision", "updated_by_user_id", "created_at", "updated_at" FROM `global_email_configs`;--> statement-breakpoint
DROP TABLE `global_email_configs`;--> statement-breakpoint
ALTER TABLE `__new_global_email_configs` RENAME TO `global_email_configs`;--> statement-breakpoint
ALTER TABLE `admin_message_deliveries` ADD `metadata` text;--> statement-breakpoint
ALTER TABLE `employee_directory_entries` ADD `group_id` text REFERENCES employee_groups(id);--> statement-breakpoint
CREATE INDEX `employee_directory_group_idx` ON `employee_directory_entries` (`group_id`);