import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { botInstances } from './bot-instances';

export const WECOM_PROACTIVE_DELIVERY_STATUSES = ['delivering', 'sent', 'failed'] as const;

export const wecomProactiveDeliveries = sqliteTable(
  'wecom_proactive_deliveries',
  {
    deliveryId: text('delivery_id').primaryKey(),
    semanticKey: text('semantic_key').notNull(),
    botInstanceId: text('bot_instance_id')
      .notNull()
      .references(() => botInstances.id, { onDelete: 'cascade' }),
    status: text('status', { enum: WECOM_PROACTIVE_DELIVERY_STATUSES })
      .notNull()
      .default('delivering'),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: text('last_error'),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    semanticKeyIndex: uniqueIndex('wecom_proactive_deliveries_semantic_key_idx')
      .on(table.semanticKey),
    statusUpdatedIndex: index('wecom_proactive_deliveries_status_updated_idx')
      .on(table.status, table.updatedAt),
    botCreatedIndex: index('wecom_proactive_deliveries_bot_created_idx')
      .on(table.botInstanceId, table.createdAt),
  }),
);

export type WecomProactiveDeliveryStatus =
  (typeof WECOM_PROACTIVE_DELIVERY_STATUSES)[number];
