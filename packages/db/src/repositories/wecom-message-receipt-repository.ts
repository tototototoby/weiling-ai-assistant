import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { wecomMessageReceipts } from '../schema/wecom-message-receipts';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;

export type WecomMessageReceiptClaimResult = 'claimed' | 'processing' | 'succeeded';

export class WecomMessageReceiptRepository {
  constructor(private readonly db: Db) {}

  async tryAccept(input: {
    botInstanceId: string;
    messageId: string;
    receivedAt?: Date;
    staleBefore?: Date;
  }): Promise<WecomMessageReceiptClaimResult> {
    const messageId = input.messageId.trim();
    if (!messageId) throw new Error('WeCom message ID is required.');
    const receivedAt = input.receivedAt ?? new Date();
    const staleBefore = input.staleBefore ?? new Date(receivedAt.getTime() - 60_000);

    return this.db.transaction((tx) => {
      const inserted = tx.insert(wecomMessageReceipts).values({
        attemptCount: 1,
        botInstanceId: input.botInstanceId,
        messageId,
        receivedAt,
        updatedAt: receivedAt,
      }).onConflictDoNothing({ target: wecomMessageReceipts.messageId }).run();
      if (inserted.changes === 1) return 'claimed';

      const existing = tx.select().from(wecomMessageReceipts)
        .where(eq(wecomMessageReceipts.messageId, messageId)).get();
      if (!existing) throw new Error('Failed to read existing WeCom message receipt.');
      if (existing.status === 'succeeded') return 'succeeded';
      if (existing.updatedAt.getTime() > staleBefore.getTime()) return 'processing';

      tx.update(wecomMessageReceipts).set({
        attemptCount: existing.attemptCount + 1,
        completedAt: null,
        error: null,
        status: 'processing',
        updatedAt: receivedAt,
      }).where(eq(wecomMessageReceipts.messageId, messageId)).run();
      return 'claimed';
    }, { behavior: 'immediate' });
  }

  async markSucceeded(messageId: string, completedAt: Date = new Date()): Promise<void> {
    this.db.update(wecomMessageReceipts).set({
      completedAt,
      error: null,
      status: 'succeeded',
      updatedAt: completedAt,
    }).where(and(
      eq(wecomMessageReceipts.messageId, messageId),
      eq(wecomMessageReceipts.status, 'processing'),
    )).run();
  }

  async markFailed(messageId: string, error: string, completedAt: Date = new Date()): Promise<void> {
    this.db.update(wecomMessageReceipts).set({
      completedAt,
      error: error.trim().slice(0, 1000),
      status: 'failed',
      updatedAt: completedAt,
    }).where(and(
      eq(wecomMessageReceipts.messageId, messageId),
      eq(wecomMessageReceipts.status, 'processing'),
    )).run();
  }
}
