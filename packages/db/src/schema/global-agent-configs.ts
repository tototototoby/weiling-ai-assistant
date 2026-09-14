import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const GLOBAL_AGENT_CONFIG_ID = 'global';

export const globalAgentConfigs = sqliteTable('global_agent_configs', {
  id: text('id').primaryKey(),
  agentsMarkdown: text('agents_markdown').notNull(),
  soulMarkdown: text('soul_markdown').notNull(),
  revision: integer('revision').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
