import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const GLOBAL_IMAGEGEN_CONFIG_ID = 'global';

export const globalImagegenConfigs = sqliteTable('global_imagegen_configs', {
  id: text('id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  endpoint: text('endpoint').notNull().default(''),
  apiKey: text('api_key').notNull().default(''),
  model: text('model').notNull().default(''),
  revision: integer('revision').notNull().default(1),
  observedRevision: integer('observed_revision'),
  updatedByUserId: text('updated_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
