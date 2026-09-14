import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { botInstances } from './bot-instances';
import { employeeDirectoryEntries } from './employee-directory-entries';

export const WECOM_ONBOARDING_SESSION_STATUSES = ['awaiting_name', 'bound'] as const;

export const wecomOnboardingSessions = sqliteTable(
  'wecom_onboarding_sessions',
  {
    wecomUserId: text('wecom_user_id').primaryKey(),
    status: text('status', { enum: WECOM_ONBOARDING_SESSION_STATUSES })
      .notNull()
      .default('awaiting_name'),
    employeeId: text('employee_id')
      .references(() => employeeDirectoryEntries.id, { onDelete: 'set null' }),
    botInstanceId: text('bot_instance_id')
      .references(() => botInstances.id, { onDelete: 'cascade' }),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: text('last_error'),
    lastPromptAt: integer('last_prompt_at', { mode: 'timestamp_ms' }).notNull(),
    cooldownUntil: integer('cooldown_until', { mode: 'timestamp_ms' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    boundAt: integer('bound_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    botInstanceIndex: uniqueIndex('wecom_onboarding_sessions_bot_idx')
      .on(table.botInstanceId),
    employeeIndex: uniqueIndex('wecom_onboarding_sessions_employee_idx')
      .on(table.employeeId),
    statusUpdatedIndex: index('wecom_onboarding_sessions_status_updated_idx')
      .on(table.status, table.updatedAt),
    cooldownIndex: index('wecom_onboarding_sessions_cooldown_idx')
      .on(table.cooldownUntil),
  }),
);

export type WecomOnboardingSessionStatus =
  (typeof WECOM_ONBOARDING_SESSION_STATUSES)[number];
