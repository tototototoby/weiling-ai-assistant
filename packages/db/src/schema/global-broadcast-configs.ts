import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const GLOBAL_BROADCAST_CONFIG_ID = 'global';

export const globalBroadcastConfigs = sqliteTable('global_broadcast_configs', {
  id: text('id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  authorizedEmployeeIdsJson: text('authorized_employee_ids_json')
    .notNull()
    .default('[]'),
  rateLimitMinutes: integer('rate_limit_minutes').notNull().default(10),
  revision: integer('revision').notNull().default(1),
  observedRevision: integer('observed_revision'),
  updatedByUserId: text('updated_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
