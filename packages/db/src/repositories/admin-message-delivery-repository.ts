import { and, asc, desc, eq, gte, inArray, lte, or } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  adminMessageDeliveries,
  type AdminMessageDeliveryStatus,
} from '../schema/admin-message-deliveries';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;
type Row = typeof adminMessageDeliveries.$inferSelect;

export interface AdminMessageDeliveryRecord extends Row {}

export interface CreateAdminMessageDeliveryInput {
  batchId: string;
  botInstanceId: string;
  createdByUserId: string;
  id: string;
  message: string;
  recipientUserId: string;
  metadata?: string | null;
}

export class AdminMessageDeliveryRepository {
  constructor(private readonly db: Db) {}

  async createBatch(
    inputs: readonly CreateAdminMessageDeliveryInput[],
    createdAt: Date = new Date(),
  ): Promise<AdminMessageDeliveryRecord[]> {
    if (inputs.length === 0) return [];
    const ids = inputs.map((input) => input.id);
    this.db.insert(adminMessageDeliveries)
      .values(inputs.map((input) => ({
        ...input,
        metadata: input.metadata ?? null,
        createdAt,
        nextAttemptAt: createdAt,
        updatedAt: createdAt,
      })))
      .onConflictDoNothing({ target: adminMessageDeliveries.id })
      .run();
    const rows = this.db.select().from(adminMessageDeliveries)
      .where(inArray(adminMessageDeliveries.id, ids))
      .orderBy(asc(adminMessageDeliveries.createdAt), asc(adminMessageDeliveries.id))
      .all();
    const rowsById = new Map(rows.map((row) => [row.id, row]));

    for (const input of inputs) {
      const row = rowsById.get(input.id);
      if (!row) throw new Error(`Failed to create admin message delivery: ${input.id}`);
      if (row.botInstanceId !== input.botInstanceId || row.message !== input.message) {
        throw new Error(`Admin message delivery identity conflict: ${input.id}`);
      }
    }

    return rows;
  }

  async listRecent(limit = 100): Promise<AdminMessageDeliveryRecord[]> {
    return this.db.select().from(adminMessageDeliveries)
      .orderBy(desc(adminMessageDeliveries.createdAt), desc(adminMessageDeliveries.id))
      .limit(limit)
      .all();
  }

  async summarizeByStatus(from: Date, to: Date): Promise<Record<string, number>> {
    const rows = this.db.select({
      status: adminMessageDeliveries.status,
    })
      .from(adminMessageDeliveries)
      .where(and(
        gte(adminMessageDeliveries.createdAt, from),
        lte(adminMessageDeliveries.createdAt, to),
      ))
      .all();
    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.status] = (counts[row.status] ?? 0) + 1;
    }
    return counts;
  }

  async listStuckDelivering(stuckBefore: Date): Promise<AdminMessageDeliveryRecord[]> {
    return this.db.select().from(adminMessageDeliveries)
      .where(and(
        eq(adminMessageDeliveries.status, 'delivering'),
        lte(adminMessageDeliveries.updatedAt, stuckBefore),
      ))
      .all();
  }

  async claimReady(input: {
    botInstanceId?: string;
    limit?: number;
    now?: Date;
    staleBefore?: Date;
  } = {}): Promise<AdminMessageDeliveryRecord[]> {
    const now = input.now ?? new Date();
    const staleBefore = input.staleBefore ?? new Date(now.getTime() - 60_000);
    const limit = input.limit ?? 20;

    return this.db.transaction((tx) => {
      const ready = or(
        and(
          eq(adminMessageDeliveries.status, 'pending'),
          lte(adminMessageDeliveries.nextAttemptAt, now),
        ),
        and(
          eq(adminMessageDeliveries.status, 'delivering'),
          lte(adminMessageDeliveries.updatedAt, staleBefore),
        ),
      );
      const condition = input.botInstanceId
        ? and(eq(adminMessageDeliveries.botInstanceId, input.botInstanceId), ready)
        : ready;
      const rows = tx.select().from(adminMessageDeliveries)
        .where(condition)
        .orderBy(asc(adminMessageDeliveries.createdAt), asc(adminMessageDeliveries.id))
        .limit(limit)
        .all();

      for (const row of rows) {
        tx.update(adminMessageDeliveries)
          .set({
            attemptCount: row.attemptCount + 1,
            lastError: null,
            status: 'delivering',
            updatedAt: now,
          })
          .where(eq(adminMessageDeliveries.id, row.id))
          .run();
      }

      if (rows.length === 0) return [];
      return tx.select().from(adminMessageDeliveries)
        .where(inArray(adminMessageDeliveries.id, rows.map((row) => row.id)))
        .orderBy(asc(adminMessageDeliveries.createdAt), asc(adminMessageDeliveries.id))
        .all();
    }, { behavior: 'immediate' });
  }

  async markSent(id: string, sentAt: Date = new Date()): Promise<void> {
    this.db.update(adminMessageDeliveries)
      .set({ lastError: null, sentAt, status: 'sent', updatedAt: sentAt })
      .where(and(
        eq(adminMessageDeliveries.id, id),
        eq(adminMessageDeliveries.status, 'delivering'),
      ))
      .run();
  }

  async markAttemptFailed(input: {
    deferAfterMaxAttempts?: boolean;
    error: string;
    id: string;
    maxAttempts?: number;
    nextAttemptAt: Date;
    updatedAt?: Date;
  }): Promise<AdminMessageDeliveryStatus> {
    return this.db.transaction((tx) => {
      const row = tx.select().from(adminMessageDeliveries)
        .where(eq(adminMessageDeliveries.id, input.id)).get();
      if (!row) throw new Error(`Admin message delivery not found: ${input.id}`);
      if (row.status !== 'delivering') return row.status;

      const exhausted = row.attemptCount >= (input.maxAttempts ?? 5);
      const status: AdminMessageDeliveryStatus = exhausted
        ? (input.deferAfterMaxAttempts ? 'waiting_for_user' : 'failed')
        : 'pending';
      const updatedAt = input.updatedAt ?? new Date();
      tx.update(adminMessageDeliveries)
        .set({
          lastError: input.error.trim() || 'Unknown delivery failure.',
          nextAttemptAt: input.nextAttemptAt,
          status,
          updatedAt,
        })
        .where(and(
          eq(adminMessageDeliveries.id, input.id),
          eq(adminMessageDeliveries.status, 'delivering'),
        ))
        .run();
      return status;
    }, { behavior: 'immediate' });
  }

  async resumeWaitingForBot(botInstanceId: string, resumedAt: Date = new Date()): Promise<number> {
    return this.db.update(adminMessageDeliveries)
      .set({
        attemptCount: 0,
        nextAttemptAt: resumedAt,
        status: 'pending',
        updatedAt: resumedAt,
      })
      .where(and(
        eq(adminMessageDeliveries.botInstanceId, botInstanceId),
        eq(adminMessageDeliveries.status, 'waiting_for_user'),
      ))
      .run().changes;
  }

  async failWaiting(failedAt: Date = new Date()): Promise<number> {
    return this.db.update(adminMessageDeliveries)
      .set({ status: 'failed', updatedAt: failedAt })
      .where(eq(adminMessageDeliveries.status, 'waiting_for_user'))
      .run().changes;
  }
}
