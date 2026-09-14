import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  scheduledTaskRecoveries,
  type ScheduledTaskRecoveryStatus,
} from '../schema/scheduled-task-recoveries';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;

export type ScheduledTaskRecoveryClaimResult = 'claimed' | 'processing' | 'delivered';

export interface ScheduledTaskRecoveryRecord {
  attemptCount: number;
  botInstanceId: string;
  createdAt: Date;
  deliveredAt: Date | null;
  error: string | null;
  kind: string;
  prompt: string;
  recoveryId: string;
  scheduledFor: Date | null;
  status: ScheduledTaskRecoveryStatus;
  taskId: string;
  updatedAt: Date;
}

export class ScheduledTaskRecoveryRepository {
  constructor(private readonly db: Db) {}

  async claim(input: {
    botInstanceId: string;
    kind: string;
    prompt: string;
    receivedAt?: Date;
    recoveryId: string;
    scheduledFor?: Date | null;
    staleBefore?: Date;
    taskId: string;
  }): Promise<ScheduledTaskRecoveryClaimResult> {
    const recoveryId = input.recoveryId.trim();
    if (!recoveryId) throw new Error('Recovery ID is required.');
    const receivedAt = input.receivedAt ?? new Date();
    const staleBefore = input.staleBefore ?? new Date(receivedAt.getTime() - 60_000);

    return this.db.transaction((tx) => {
      const inserted = tx.insert(scheduledTaskRecoveries).values({
        attemptCount: 1,
        botInstanceId: input.botInstanceId,
        createdAt: receivedAt,
        kind: input.kind,
        prompt: input.prompt,
        recoveryId,
        scheduledFor: input.scheduledFor ?? null,
        status: 'delivering',
        taskId: input.taskId,
        updatedAt: receivedAt,
      }).onConflictDoNothing({ target: scheduledTaskRecoveries.recoveryId }).run();
      if (inserted.changes === 1) return 'claimed';

      const existing = tx.select().from(scheduledTaskRecoveries)
        .where(eq(scheduledTaskRecoveries.recoveryId, recoveryId)).get();
      if (!existing) throw new Error('Failed to read existing scheduled task recovery.');
      if (existing.status === 'delivered') return 'delivered';
      if (existing.status === 'delivering' && existing.updatedAt.getTime() > staleBefore.getTime()) {
        return 'processing';
      }

      tx.update(scheduledTaskRecoveries).set({
        attemptCount: existing.attemptCount + 1,
        error: null,
        status: 'delivering',
        updatedAt: receivedAt,
      }).where(eq(scheduledTaskRecoveries.recoveryId, recoveryId)).run();
      return 'claimed';
    }, { behavior: 'immediate' });
  }

  async markDelivered(recoveryId: string, deliveredAt: Date = new Date()): Promise<void> {
    this.db.update(scheduledTaskRecoveries).set({
      deliveredAt,
      error: null,
      status: 'delivered',
      updatedAt: deliveredAt,
    }).where(and(
      eq(scheduledTaskRecoveries.recoveryId, recoveryId),
      eq(scheduledTaskRecoveries.status, 'delivering'),
    )).run();
  }

  async markFailed(recoveryId: string, error: string, failedAt: Date = new Date()): Promise<void> {
    this.db.update(scheduledTaskRecoveries).set({
      error: error.trim().slice(0, 1000),
      status: 'failed',
      updatedAt: failedAt,
    }).where(and(
      eq(scheduledTaskRecoveries.recoveryId, recoveryId),
      eq(scheduledTaskRecoveries.status, 'delivering'),
    )).run();
  }
}
