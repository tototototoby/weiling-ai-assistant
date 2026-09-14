import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const GLOBAL_EMAIL_CONFIG_ID = 'global';
export const EMAIL_SECURITY_MODES = ['ssl', 'starttls'] as const;
export type EmailSecurityMode = (typeof EMAIL_SECURITY_MODES)[number];

export const globalEmailConfigs = sqliteTable('global_email_configs', {
  id: text('id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  smtpHost: text('smtp_host').notNull().default('smtp.exmail.qq.com'),
  smtpPort: integer('smtp_port').notNull().default(465),
  smtpSecurity: text('smtp_security', { enum: EMAIL_SECURITY_MODES }).notNull().default('ssl'),
  senderEmail: text('sender_email'),
  senderName: text('sender_name').notNull().default('微Link · 微灵 AI 助手'),
  revision: integer('revision').notNull().default(1),
  observedRevision: integer('observed_revision'),
  updatedByUserId: text('updated_by_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
