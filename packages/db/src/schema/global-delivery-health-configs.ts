import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const GLOBAL_DELIVERY_HEALTH_CONFIG_ID = 'global';

export const globalDeliveryHealthConfigs = sqliteTable(
  'global_delivery_health_configs',
  {
    id: text('id').primaryKey(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    checkTime: text('check_time').notNull().default('09:00'),
    failedThreshold: integer('failed_threshold').notNull().default(3),
    stuckHours: integer('stuck_hours').notNull().default(24),
    alertEmail: text('alert_email'),
    revision: integer('revision').notNull().default(1),
    observedRevision: integer('observed_revision'),
    updatedByUserId: text('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
);
