import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const WECOM_ONBOARDING_RECEIPT_STATUSES = [
  'processing',
  'completed',
] as const;

export const wecomOnboardingReceipts = sqliteTable(
  'wecom_onboarding_receipts',
  {
    messageId: text('message_id').primaryKey(),
    wecomUserId: text('wecom_user_id').notNull(),
    status: text('status', { enum: WECOM_ONBOARDING_RECEIPT_STATUSES })
      .notNull()
      .default('processing'),
    error: text('error'),
    response: text('response'),
    attemptCount: integer('attempt_count').notNull().default(0),
    receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    userReceivedIndex: index('wecom_onboarding_receipts_user_received_idx').on(
      table.wecomUserId,
      table.receivedAt,
    ),
  }),
);

export type WecomOnboardingReceiptStatus =
  (typeof WECOM_ONBOARDING_RECEIPT_STATUSES)[number];
