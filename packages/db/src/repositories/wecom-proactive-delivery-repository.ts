import { and, eq, or } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { wecomProactiveDeliveries } from '../schema/wecom-proactive-deliveries';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;
type Row = typeof wecomProactiveDeliveries.$inferSelect;

export interface WecomProactiveDeliveryRecord extends Row {}

export type WecomProactiveDeliveryClaimResult =
  'claimed' | 'processing' | 'sent' | 'failed';

export class WecomProactiveDeliveryRepository {
  constructor(private readonly db: Db) {}

  async findBySemanticKey(semanticKey: string): Promise<WecomProactiveDeliveryRecord | null> {
    return this.db.select().from(wecomProactiveDeliveries)
      .where(eq(wecomProactiveDeliveries.semanticKey, normalizeKey(semanticKey, 'semantic key')))
      .get() ?? null;
  }

  async claim(input: {
    botInstanceId: string;
    deliveryId: string;
    now?: Date;
    semanticKey: string;
    staleBefore?: Date;
  }): Promise<WecomProactiveDeliveryClaimResult> {
    const deliveryId = normalizeKey(input.deliveryId, 'delivery ID');
    const semanticKey = normalizeKey(input.semanticKey, 'semantic key');
    const now = input.now ?? new Date();
    const staleBefore = input.staleBefore ?? new Date(now.getTime() - 60_000);

    return this.db.transaction((tx) => {
      const inserted = tx.insert(wecomProactiveDeliveries).values({
        attemptCount: 1,
        botInstanceId: input.botInstanceId,
        createdAt: now,
        deliveryId,
        semanticKey,
        updatedAt: now,
      }).onConflictDoNothing().run();
      if (inserted.changes === 1) return 'claimed';

      const existing = tx.select().from(wecomProactiveDeliveries).where(or(
        eq(wecomProactiveDeliveries.deliveryId, deliveryId),
        eq(wecomProactiveDeliveries.semanticKey, semanticKey),
      )).get();
      if (!existing) throw new Error('Failed to read existing WeCom proactive delivery.');
      if (
        existing.deliveryId !== deliveryId
        || existing.semanticKey !== semanticKey
        || existing.botInstanceId !== input.botInstanceId
      ) {
        throw new Error('WeCom proactive delivery identity conflict.');
      }
      if (existing.status === 'sent') return 'sent';
      if (existing.updatedAt.getTime() > staleBefore.getTime()) {
        return existing.status === 'failed' ? 'failed' : 'processing';
      }

      tx.update(wecomProactiveDeliveries).set({
        attemptCount: existing.attemptCount + 1,
        lastError: null,
        status: 'delivering',
        updatedAt: now,
      }).where(eq(wecomProactiveDeliveries.deliveryId, deliveryId)).run();
      return 'claimed';
    }, { behavior: 'immediate' });
  }

  async markSent(deliveryId: string, sentAt: Date = new Date()): Promise<boolean> {
    return this.db.update(wecomProactiveDeliveries).set({
      lastError: null,
      sentAt,
      status: 'sent',
      updatedAt: sentAt,
    }).where(and(
      eq(wecomProactiveDeliveries.deliveryId, normalizeKey(deliveryId, 'delivery ID')),
      eq(wecomProactiveDeliveries.status, 'delivering'),
    )).run().changes > 0;
  }

  async markFailed(
    deliveryId: string,
    error: string,
    failedAt: Date = new Date(),
  ): Promise<boolean> {
    return this.db.update(wecomProactiveDeliveries).set({
      lastError: error.trim().slice(0, 1000) || 'Unknown delivery failure.',
      status: 'failed',
      updatedAt: failedAt,
    }).where(and(
      eq(wecomProactiveDeliveries.deliveryId, normalizeKey(deliveryId, 'delivery ID')),
      eq(wecomProactiveDeliveries.status, 'delivering'),
    )).run().changes > 0;
  }
}

function normalizeKey(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 500) {
    throw new Error(`Invalid WeCom proactive delivery ${label}.`);
  }
  return normalized;
}
