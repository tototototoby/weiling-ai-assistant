import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { botInstances } from './bot-instances';

export const botFeishuGroupSessions = sqliteTable(
  'bot_feishu_group_sessions',
  {
    botInstanceId: text('bot_instance_id')
      .notNull()
      .references(() => botInstances.id, { onDelete: 'cascade' }),
    chatId: text('chat_id').notNull(),
    sessionId: text('session_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.botInstanceId, table.chatId] }),
  }),
);
