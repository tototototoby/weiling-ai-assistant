import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const GLOBAL_RAGFLOW_CONFIG_ID = 'global';
export const RAGFLOW_TEST_STATUSES = ['untested', 'success', 'error'] as const;

export const globalRagflowConfigs = sqliteTable('global_ragflow_configs', {
  id: text('id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  apiBaseUrl: text('api_base_url').notNull().default(''),
  apiKey: text('api_key').notNull().default(''),
  knowledgeBaseName: text('knowledge_base_name').notNull().default('公司 RAGFlow 知识库'),
  datasetIdsJson: text('dataset_ids_json').notNull().default('[]'),
  revision: integer('revision').notNull().default(1),
  lastTestStatus: text('last_test_status', { enum: RAGFLOW_TEST_STATUSES })
    .notNull()
    .default('untested'),
  lastTestError: text('last_test_error'),
  lastTestedAt: integer('last_tested_at', { mode: 'timestamp_ms' }),
  updatedByUserId: text('updated_by_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export type RagflowTestStatus = (typeof RAGFLOW_TEST_STATUSES)[number];
