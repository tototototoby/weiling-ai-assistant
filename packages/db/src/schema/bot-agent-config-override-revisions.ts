import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { botInstances } from './bot-instances';

export const botAgentConfigOverrideRevisions = sqliteTable(
  'bot_agent_config_override_revisions',
  {
    id: text('id').primaryKey(),
    botInstanceId: text('bot_instance_id')
      .notNull()
      .references(() => botInstances.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    agentsAppendix: text('agents_appendix').notNull(),
    soulAppendix: text('soul_appendix').notNull(),
    changeReason: text('change_reason').notNull(),
    updatedByEmail: text('updated_by_email').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    botRevisionIndex: uniqueIndex('bot_agent_override_bot_revision_idx')
      .on(table.botInstanceId, table.revision),
    botCreatedAtIndex: index('bot_agent_override_bot_created_at_idx')
      .on(table.botInstanceId, table.createdAt),
  }),
);
