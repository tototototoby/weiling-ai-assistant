import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const GLOBAL_ADMIN_MESSAGE_CONFIG_ID = 'global';

export const GLOBAL_ADMIN_MESSAGE_COPY_KEYS = [
  'assistantName',
  'mealConsentPrompt',
  'mealRainReminder',
  'mealStandardReminder',
  'morningBriefingIntro',
  'processingAck',
  'wecomAck',
  'wecomDuplicate',
  'wecomCompleted',
  'wecomFailure',
  'wecomUnsupported',
  'wecomGroupUnsupported',
  'wecomUnbound',
  'wecomBindingNamePrompt',
  'wecomBindingNameInvalid',
  'wecomBindingSuccess',
] as const;

export type GlobalAdminMessageCopyKey = (typeof GLOBAL_ADMIN_MESSAGE_COPY_KEYS)[number];
export type GlobalAdminMessageCopy = Record<GlobalAdminMessageCopyKey, string>;

export const DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY: Readonly<GlobalAdminMessageCopy> = Object.freeze({
  assistantName: '微Link · 微灵 AI 助手',
  mealConsentPrompt: '我是微Link。工作日需要我提醒你点外卖吗？需要的话请回复“开启外卖提醒”，不需要请回复“关闭外卖提醒”。',
  mealRainReminder: '我是微Link。今天可能下雨，外卖配送可能会比平时慢，记得现在点外卖。',
  mealStandardReminder: '我是微Link。该点外卖了，记得安排今天的午餐。',
  morningBriefingIntro: '早上好，我是微Link。今天是 {{date}}。',
  processingAck: '收到，我是微Link，正在处理，完成后把结果发给你。',
  wecomAck: '微Link已收到，正在处理，完成后把结果发给你。',
  wecomDuplicate: '微Link已收到这条消息，正在处理中，请稍候。',
  wecomCompleted: '微Link已经处理完这条消息，请勿重复发送。',
  wecomFailure: '微Link这次处理没有完成，请稍后重新发送。',
  wecomUnsupported: '我是微Link。当前企业微信通道支持文字和语音转文字，请补充文字说明。',
  wecomGroupUnsupported: '我是微Link。当前仅支持用户与机器人单聊。',
  wecomUnbound: '我是微Link。你的企业微信账号尚未绑定用户 Bot，请联系管理员完成绑定。',
  wecomBindingNamePrompt: '我是微Link。为了绑定你已有的用户 Bot，请回复你的姓名或常用称呼。',
  wecomBindingNameInvalid: '我是微Link。暂时无法确认你的用户身份，请核对姓名或常用称呼后重试，或联系管理员。',
  wecomBindingSuccess: '我是微Link。企业微信已绑定到你的用户 Bot，之后会继续使用同一会话、记忆和工具。',
});

export const globalAdminMessageConfigs = sqliteTable('global_admin_message_configs', {
  id: text('id').primaryKey(),
  deferFailedUntilUserActive: integer('defer_failed_until_user_active', { mode: 'boolean' })
    .notNull()
    .default(true),
  assistantName: text('assistant_name').notNull().default('微Link · 微灵 AI 助手'),
  mealConsentPrompt: text('meal_consent_prompt').notNull().default('我是微Link。工作日需要我提醒你点外卖吗？需要的话请回复“开启外卖提醒”，不需要请回复“关闭外卖提醒”。'),
  mealRainReminder: text('meal_rain_reminder').notNull().default('我是微Link。今天可能下雨，外卖配送可能会比平时慢，记得现在点外卖。'),
  mealStandardReminder: text('meal_standard_reminder').notNull().default('我是微Link。该点外卖了，记得安排今天的午餐。'),
  morningBriefingIntro: text('morning_briefing_intro').notNull().default('早上好，我是微Link。今天是 {{date}}。'),
  processingAck: text('processing_ack').notNull().default('收到，我是微Link，正在处理，完成后把结果发给你。'),
  wecomAck: text('wecom_ack').notNull().default('微Link已收到，正在处理，完成后把结果发给你。'),
  wecomDuplicate: text('wecom_duplicate').notNull().default('微Link已收到这条消息，正在处理中，请稍候。'),
  wecomCompleted: text('wecom_completed').notNull().default('微Link已经处理完这条消息，请勿重复发送。'),
  wecomFailure: text('wecom_failure').notNull().default('微Link这次处理没有完成，请稍后重新发送。'),
  wecomUnsupported: text('wecom_unsupported').notNull().default('我是微Link。当前企业微信通道支持文字和语音转文字，请补充文字说明。'),
  wecomGroupUnsupported: text('wecom_group_unsupported').notNull().default('我是微Link。当前仅支持用户与机器人单聊。'),
  wecomUnbound: text('wecom_unbound').notNull().default('我是微Link。你的企业微信账号尚未绑定用户 Bot，请联系管理员完成绑定。'),
  wecomBindingNamePrompt: text('wecom_binding_name_prompt').notNull().default('我是微Link。为了绑定你已有的用户 Bot，请回复你的姓名或常用称呼。'),
  wecomBindingNameInvalid: text('wecom_binding_name_invalid').notNull().default('我是微Link。暂时无法确认你的用户身份，请核对姓名或常用称呼后重试，或联系管理员。'),
  wecomBindingSuccess: text('wecom_binding_success').notNull().default('我是微Link。企业微信已绑定到你的用户 Bot，之后会继续使用同一会话、记忆和工具。'),
  revision: integer('revision').notNull().default(1),
  observedRevision: integer('observed_revision'),
  updatedByUserId: text('updated_by_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
