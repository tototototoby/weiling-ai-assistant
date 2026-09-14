import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { botInstances } from './bot-instances';

export const botAgentConfigOverrides = sqliteTable('bot_agent_config_overrides', {
  botInstanceId: text('bot_instance_id')
    .primaryKey()
    .references(() => botInstances.id, { onDelete: 'cascade' }),
  agentsAppendix: text('agents_appendix').notNull().default(''),
  soulAppendix: text('soul_appendix').notNull().default(''),
  revision: integer('revision').notNull().default(1),
  changeReason: text('change_reason').notNull(),
  updatedByEmail: text('updated_by_email').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
