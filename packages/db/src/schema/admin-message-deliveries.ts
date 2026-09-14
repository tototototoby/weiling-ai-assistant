import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { botInstances } from './bot-instances';
import { users } from './users';

export const ADMIN_MESSAGE_DELIVERY_STATUSES = [
  'pending',
  'delivering',
  'waiting_for_user',
  'sent',
  'failed',
] as const;

export const adminMessageDeliveries = sqliteTable(
  'admin_message_deliveries',
  {
    id: text('id').primaryKey(),
    batchId: text('batch_id').notNull(),
    botInstanceId: text('bot_instance_id')
      .notNull()
      .references(() => botInstances.id, { onDelete: 'cascade' }),
    recipientUserId: text('recipient_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    message: text('message').notNull(),
    status: text('status', { enum: ADMIN_MESSAGE_DELIVERY_STATUSES })
      .notNull()
      .default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp_ms' }).notNull(),
    lastError: text('last_error'),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    metadata: text('metadata'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    readyIndex: index('admin_message_deliveries_ready_idx').on(
      table.status,
      table.nextAttemptAt,
      table.createdAt,
    ),
    batchIndex: index('admin_message_deliveries_batch_idx').on(table.batchId, table.createdAt),
    botIndex: index('admin_message_deliveries_bot_idx').on(table.botInstanceId, table.createdAt),
    waitingBotIndex: index('admin_message_deliveries_waiting_bot_idx').on(
      table.status,
      table.botInstanceId,
      table.createdAt,
    ),
  }),
);

export type AdminMessageDeliveryStatus = (typeof ADMIN_MESSAGE_DELIVERY_STATUSES)[number];
