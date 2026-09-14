ALTER TABLE `global_admin_message_configs` ADD `assistant_name` text DEFAULT '微Link · 微灵 AI 助手' NOT NULL;
--> statement-breakpoint
ALTER TABLE `global_admin_message_configs` ADD `meal_consent_prompt` text DEFAULT '我是{{assistantName}}。工作日需要我提醒你点外卖吗？需要的话请回复“开启外卖提醒”，不需要请回复“关闭外卖提醒”。' NOT NULL;
--> statement-breakpoint
ALTER TABLE `global_admin_message_configs` ADD `meal_rain_reminder` text DEFAULT '我是{{assistantName}}。今天可能下雨，外卖配送可能会比平时慢，记得现在点外卖。' NOT NULL;
--> statement-breakpoint
ALTER TABLE `global_admin_message_configs` ADD `meal_standard_reminder` text DEFAULT '我是{{assistantName}}。该点外卖了，记得安排今天的午餐。' NOT NULL;
--> statement-breakpoint
ALTER TABLE `global_admin_message_configs` ADD `morning_briefing_intro` text DEFAULT '早上好，我是{{assistantName}}。今天是 {{date}}。' NOT NULL;
--> statement-breakpoint
ALTER TABLE `global_admin_message_configs` ADD `processing_ack` text DEFAULT '收到，我是{{assistantName}}，正在处理，完成后把结果发给你。' NOT NULL;
--> statement-breakpoint
ALTER TABLE `global_admin_message_configs` ADD `wecom_ack` text DEFAULT '{{assistantName}}已收到，正在处理，完成后把结果发给你。' NOT NULL;
--> statement-breakpoint
ALTER TABLE `global_admin_message_configs` ADD `wecom_duplicate` text DEFAULT '{{assistantName}}已收到这条消息，正在处理中，请稍候。' NOT NULL;
--> statement-breakpoint
ALTER TABLE `global_admin_message_configs` ADD `wecom_completed` text DEFAULT '{{assistantName}}已经处理完这条消息，请勿重复发送。' NOT NULL;
--> statement-breakpoint
ALTER TABLE `global_admin_message_configs` ADD `wecom_failure` text DEFAULT '{{assistantName}}这次处理没有完成，请稍后重新发送。' NOT NULL;
--> statement-breakpoint
ALTER TABLE `global_admin_message_configs` ADD `wecom_unsupported` text DEFAULT '我是{{assistantName}}。当前企业微信通道支持文字和语音转文字，请补充文字说明。' NOT NULL;
--> statement-breakpoint
ALTER TABLE `global_admin_message_configs` ADD `wecom_group_unsupported` text DEFAULT '我是{{assistantName}}。当前仅支持员工与机器人单聊。' NOT NULL;
--> statement-breakpoint
ALTER TABLE `global_admin_message_configs` ADD `wecom_unbound` text DEFAULT '我是{{assistantName}}。你的企业微信账号尚未绑定员工 Bot，请联系管理员完成绑定。' NOT NULL;
--> statement-breakpoint
ALTER TABLE `global_admin_message_configs` ADD `wecom_binding_name_prompt` text DEFAULT '我是{{assistantName}}。为了绑定你已有的员工 Bot，请回复你的姓名或常用称呼。' NOT NULL;
--> statement-breakpoint
ALTER TABLE `global_admin_message_configs` ADD `wecom_binding_name_invalid` text DEFAULT '我是{{assistantName}}。暂时无法确认你的员工身份，请核对姓名或常用称呼后重试，或联系管理员。' NOT NULL;
--> statement-breakpoint
ALTER TABLE `global_admin_message_configs` ADD `wecom_binding_success` text DEFAULT '我是{{assistantName}}。企业微信已绑定到你的员工 Bot，之后会继续使用同一会话、记忆和工具。' NOT NULL;
--> statement-breakpoint
ALTER TABLE `global_admin_message_configs` ADD `revision` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `global_admin_message_configs` ADD `observed_revision` integer;
--> statement-breakpoint
ALTER TABLE `global_admin_message_configs` ADD `updated_by_user_id` text REFERENCES users(id) ON DELETE SET NULL;
