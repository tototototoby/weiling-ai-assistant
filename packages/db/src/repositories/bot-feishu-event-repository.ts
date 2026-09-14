import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { botFeishuEvents } from '../schema/bot-feishu-events';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;

export type FeishuEventClaimResult = 'claimed' | 'processing' | 'succeeded';

export class BotFeishuEventRepository {
  constructor(private readonly db: Db) {}

  async tryAccept(input: {
    botInstanceId: string;
    chatId: string;
    eventId: string;
    messageId: string;
    receivedAt?: Date;
    senderOpenId: string;
    staleBefore?: Date;
  }): Promise<FeishuEventClaimResult> {
    const eventId = input.eventId.trim();
    if (!eventId) throw new Error('Feishu event ID is required.');
    const receivedAt = input.receivedAt ?? new Date();
    const staleBefore = input.staleBefore ?? new Date(receivedAt.getTime() - 60_000);

    return this.db.transaction((tx) => {
      const inserted = tx.insert(botFeishuEvents).values({
        attemptCount: 1,
        botInstanceId: input.botInstanceId,
        chatId: input.chatId,
        eventId,
        messageId: input.messageId,
        receivedAt,
        senderOpenId: input.senderOpenId,
        updatedAt: receivedAt,
      }).onConflictDoNothing({ target: botFeishuEvents.eventId }).run();
      if (inserted.changes === 1) return 'claimed';

      const existing = tx.select().from(botFeishuEvents)
        .where(eq(botFeishuEvents.eventId, eventId)).get();
      if (!existing) throw new Error('Failed to read existing Feishu event receipt.');
      if (existing.status === 'succeeded') return 'succeeded';
      if (existing.updatedAt.getTime() > staleBefore.getTime()) return 'processing';

      tx.update(botFeishuEvents).set({
        attemptCount: existing.attemptCount + 1,
        completedAt: null,
        error: null,
        status: 'processing',
        updatedAt: receivedAt,
      }).where(eq(botFeishuEvents.eventId, eventId)).run();
      return 'claimed';
    }, { behavior: 'immediate' });
  }

  async markSucceeded(eventId: string, completedAt: Date = new Date()): Promise<void> {
    this.db.update(botFeishuEvents).set({
      completedAt,
      error: null,
      status: 'succeeded',
      updatedAt: completedAt,
    }).where(and(
      eq(botFeishuEvents.eventId, eventId),
      eq(botFeishuEvents.status, 'processing'),
    )).run();
  }

  async markFailed(eventId: string, error: string, completedAt: Date = new Date()): Promise<void> {
    this.db.update(botFeishuEvents).set({
      completedAt,
      error: error.trim().slice(0, 1000),
      status: 'failed',
      updatedAt: completedAt,
    }).where(and(
      eq(botFeishuEvents.eventId, eventId),
      eq(botFeishuEvents.status, 'processing'),
    )).run();
  }
}
