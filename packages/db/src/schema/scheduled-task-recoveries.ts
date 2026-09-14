import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { botInstances } from './bot-instances';

export const SCHEDULED_TASK_RECOVERY_STATUSES = [
  'pending',
  'delivering',
  'delivered',
  'failed',
] as const;

export const scheduledTaskRecoveries = sqliteTable(
  'scheduled_task_recoveries',
  {
    recoveryId: text('recovery_id').primaryKey(),
    botInstanceId: text('bot_instance_id')
      .notNull()
      .references(() => botInstances.id, { onDelete: 'cascade' }),
    taskId: text('task_id').notNull(),
    kind: text('kind').notNull().default('missed_one_shot'),
    scheduledFor: integer('scheduled_for', { mode: 'timestamp_ms' }),
    prompt: text('prompt').notNull(),
    status: text('status', { enum: SCHEDULED_TASK_RECOVERY_STATUSES })
      .notNull()
      .default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    error: text('error'),
    deliveredAt: integer('delivered_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    botStatusIndex: index('scheduled_task_recoveries_bot_status_idx').on(
      table.botInstanceId,
      table.status,
    ),
  }),
);

export type ScheduledTaskRecoveryStatus = (typeof SCHEDULED_TASK_RECOVERY_STATUSES)[number];
