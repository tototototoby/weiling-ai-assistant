import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const GLOBAL_DIFY_CONFIG_ID = 'global';
export const DIFY_TEST_STATUSES = ['untested', 'success', 'error'] as const;

export const globalDifyConfigs = sqliteTable('global_dify_configs', {
  id: text('id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  apiBaseUrl: text('api_base_url').notNull().default(''),
  apiKey: text('api_key').notNull().default(''),
  appName: text('app_name').notNull().default('公司知识库'),
  revision: integer('revision').notNull().default(1),
  lastTestStatus: text('last_test_status', { enum: DIFY_TEST_STATUSES })
    .notNull()
    .default('untested'),
  lastTestError: text('last_test_error'),
  lastTestedAt: integer('last_tested_at', { mode: 'timestamp_ms' }),
  updatedByUserId: text('updated_by_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export type DifyTestStatus = (typeof DIFY_TEST_STATUSES)[number];
