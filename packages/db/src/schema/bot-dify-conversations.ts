import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { botInstances } from './bot-instances';

export const botDifyConversations = sqliteTable('bot_dify_conversations', {
  botInstanceId: text('bot_instance_id')
    .primaryKey()
    .references(() => botInstances.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id').notNull(),
  configRevision: integer('config_revision').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
