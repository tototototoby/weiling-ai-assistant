import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { botInstances } from './bot-instances';

export const MORNING_BRIEFING_SYNC_STATUSES = ['pending', 'synced', 'error'] as const;

export const botMorningBriefingPolicies = sqliteTable(
  'bot_morning_briefing_policies',
  {
    botInstanceId: text('bot_instance_id')
      .primaryKey()
      .references(() => botInstances.id, { onDelete: 'cascade' }),
    adminEnabled: integer('admin_enabled', { mode: 'boolean' }).notNull().default(true),
    location: text('location').notNull().default('北京'),
    deliveryTime: text('delivery_time').notNull().default('08:30'),
    timezone: text('timezone').notNull().default('Asia/Shanghai'),
    forceEnabled: integer('force_enabled', { mode: 'boolean' }).notNull().default(false),
    observedUserOptOut: integer('observed_user_opt_out', { mode: 'boolean' }).notNull().default(false),
    desiredRevision: integer('desired_revision').notNull().default(1),
    appliedRevision: integer('applied_revision').notNull().default(0),
    syncStatus: text('sync_status', { enum: MORNING_BRIEFING_SYNC_STATUSES })
      .notNull()
      .default('pending'),
    lastSyncError: text('last_sync_error'),
    lastSyncedAt: integer('last_synced_at', { mode: 'timestamp_ms' }),
    runtimeScheduleTaskId: text('runtime_schedule_task_id'),
    runtimeScheduledFor: text('runtime_scheduled_for'),
    runtimeNeedsSchedule: integer('runtime_needs_schedule', { mode: 'boolean' })
      .notNull()
      .default(false),
    runtimeNeedsCleanup: integer('runtime_needs_cleanup', { mode: 'boolean' })
      .notNull()
      .default(false),
    runtimeObservedAt: integer('runtime_observed_at', { mode: 'timestamp_ms' }),
    centralScheduledFor: text('central_scheduled_for'),
    centralLastDeliveryDate: text('central_last_delivery_date'),
    centralLastDeliveredAt: integer('central_last_delivered_at', { mode: 'timestamp_ms' }),
    centralLastError: text('central_last_error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
);

export type MorningBriefingSyncStatus = (typeof MORNING_BRIEFING_SYNC_STATUSES)[number];
