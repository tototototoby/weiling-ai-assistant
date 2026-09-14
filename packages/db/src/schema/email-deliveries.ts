import { asc, desc } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { botInstances } from './bot-instances';
import { users } from './users';

export const EMAIL_DELIVERY_STATUSES = ['pending', 'delivering', 'sent', 'failed'] as const;
export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];

export const EMAIL_DELIVERY_SOURCES = ['admin', 'morning-briefing'] as const;
export type EmailDeliverySource = (typeof EMAIL_DELIVERY_SOURCES)[number];

export const emailDeliveries = sqliteTable(
  'email_deliveries',
  {
    id: text('id').primaryKey(),
    semanticKey: text('semantic_key').notNull(),
    source: text('source', { enum: EMAIL_DELIVERY_SOURCES }).notNull(),
    botInstanceId: text('bot_instance_id')
      .notNull()
      .references(() => botInstances.id, { onDelete: 'cascade' }),
    recipientUserId: text('recipient_user_id')
      .references(() => users.id, { onDelete: 'set null' }),
    recipientEmail: text('recipient_email').notNull(),
    createdByUserId: text('created_by_user_id')
      .references(() => users.id, { onDelete: 'set null' }),
    subject: text('subject').notNull(),
    message: text('message').notNull(),
    status: text('status', { enum: EMAIL_DELIVERY_STATUSES }).notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp_ms' }).notNull(),
    lastError: text('last_error'),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    semanticKeyIndex: uniqueIndex('email_deliveries_semantic_key_idx').on(table.semanticKey),
    readyIndex: index('email_deliveries_ready_idx').on(table.status, table.nextAttemptAt, table.createdAt),
    botIndex: index('email_deliveries_bot_idx').on(table.botInstanceId, desc(table.createdAt)),
    sourceIndex: index('email_deliveries_source_idx').on(table.source, desc(table.createdAt)),
  }),
);
