import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { botInstances } from './bot-instances';

export const FEISHU_RECEIPT_STATUSES = ['processing', 'succeeded', 'failed'] as const;

export const botFeishuEvents = sqliteTable(
  'bot_feishu_events',
  {
    eventId: text('event_id').primaryKey(),
    messageId: text('message_id').notNull(),
    botInstanceId: text('bot_instance_id')
      .notNull()
      .references(() => botInstances.id, { onDelete: 'cascade' }),
    chatId: text('chat_id').notNull(),
    senderOpenId: text('sender_open_id').notNull(),
    status: text('status', { enum: FEISHU_RECEIPT_STATUSES })
      .notNull()
      .default('processing'),
    error: text('error'),
    attemptCount: integer('attempt_count').notNull().default(0),
    receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    botReceivedIndex: index('bot_feishu_events_bot_received_idx').on(
      table.botInstanceId,
      table.receivedAt,
    ),
  }),
);

export type FeishuReceiptStatus = (typeof FEISHU_RECEIPT_STATUSES)[number];
