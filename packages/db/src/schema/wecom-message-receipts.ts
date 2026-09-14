import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { botInstances } from './bot-instances';

export const WECOM_MESSAGE_RECEIPT_STATUSES = ['processing', 'succeeded', 'failed'] as const;

export const wecomMessageReceipts = sqliteTable(
  'wecom_message_receipts',
  {
    messageId: text('message_id').primaryKey(),
    botInstanceId: text('bot_instance_id')
      .notNull()
      .references(() => botInstances.id, { onDelete: 'cascade' }),
    status: text('status', { enum: WECOM_MESSAGE_RECEIPT_STATUSES })
      .notNull()
      .default('processing'),
    error: text('error'),
    attemptCount: integer('attempt_count').notNull().default(0),
    receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    botReceivedIndex: index('wecom_message_receipts_bot_received_idx').on(
      table.botInstanceId,
      table.receivedAt,
    ),
  }),
);

export type WecomMessageReceiptStatus = (typeof WECOM_MESSAGE_RECEIPT_STATUSES)[number];
