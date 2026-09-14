import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { botInstances } from './bot-instances';
import { users } from './users';

export const WEB_CHAT_MESSAGE_ROLES = ['user', 'assistant'] as const;
export const WEB_CHAT_MESSAGE_STATUSES = ['pending', 'streaming', 'succeeded', 'failed'] as const;

export const webChatMessages = sqliteTable(
  'web_chat_messages',
  {
    id: text('id').primaryKey(),
    botInstanceId: text('bot_instance_id')
      .notNull()
      .references(() => botInstances.id, { onDelete: 'cascade' }),
    ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    role: text('role', { enum: WEB_CHAT_MESSAGE_ROLES }).notNull(),
    content: text('content').notNull(),
    toolEventsJson: text('tool_events_json'),
    requestId: text('request_id'),
    status: text('status', { enum: WEB_CHAT_MESSAGE_STATUSES }).notNull().default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    botCreatedIndex: index('web_chat_messages_bot_created_idx').on(
      table.botInstanceId,
      table.createdAt,
    ),
    requestIdIndex: uniqueIndex('web_chat_messages_request_id_idx').on(table.requestId),
  }),
);

export type WebChatMessageRole = (typeof WEB_CHAT_MESSAGE_ROLES)[number];
export type WebChatMessageStatus = (typeof WEB_CHAT_MESSAGE_STATUSES)[number];
