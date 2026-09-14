import { and, asc, desc, eq, inArray, lte, or } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  emailDeliveries,
  EMAIL_DELIVERY_SOURCES,
  type EmailDeliverySource,
  type EmailDeliveryStatus,
} from '../schema/email-deliveries';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;
type Row = typeof emailDeliveries.$inferSelect;

export interface EmailDeliveryRecord extends Row {}

export interface CreateEmailDeliveryInput {
  botInstanceId: string;
  createdByUserId?: string | null;
  id: string;
  message: string;
  nextAttemptAt?: Date;
  recipientEmail: string;
  recipientUserId?: string | null;
  semanticKey: string;
  source: EmailDeliverySource;
  subject: string;
}

export class EmailDeliveryRepository {
  constructor(private readonly db: Db) {}

  async createBatch(
    inputs: readonly CreateEmailDeliveryInput[],
    createdAt: Date = new Date(),
  ): Promise<EmailDeliveryRecord[]> {
    if (inputs.length === 0) return [];

    const prepared = inputs.map((input) => normalizeCreateInput(input, createdAt));
    const ids = prepared.map((input) => input.id);
    const semanticKeys = prepared.map((input) => input.semanticKey);

    return this.db.transaction((tx) => {
      tx.insert(emailDeliveries)
        .values(prepared.map((input) => ({
          ...input,
          createdAt,
          updatedAt: createdAt,
        })))
        .onConflictDoNothing()
        .run();

      const rows = tx.select().from(emailDeliveries).where(or(
        inArray(emailDeliveries.id, ids),
        inArray(emailDeliveries.semanticKey, semanticKeys),
      )).orderBy(asc(emailDeliveries.createdAt), asc(emailDeliveries.id)).all();
      const rowsById = new Map(rows.map((row) => [row.id, row]));
      const rowsBySemanticKey = new Map(rows.map((row) => [row.semanticKey, row]));

      for (const input of prepared) {
        const row = rowsById.get(input.id) ?? rowsBySemanticKey.get(input.semanticKey);
        if (!row) throw new Error(`Failed to create email delivery: ${input.id}`);
        if (!sameIdentity(row, input)) {
          throw new Error(`Email delivery identity conflict: ${input.id}`);
        }
      }

      return rows;
    }, { behavior: 'immediate' });
  }

  async listRecent(limit = 100): Promise<EmailDeliveryRecord[]> {
    return this.db.select().from(emailDeliveries)
      .orderBy(desc(emailDeliveries.createdAt), desc(emailDeliveries.id))
      .limit(limit)
      .all();
  }

  async claimReady(input: {
    botInstanceId?: string;
    limit?: number;
    now?: Date;
    source?: EmailDeliverySource;
    staleBefore?: Date;
  } = {}): Promise<EmailDeliveryRecord[]> {
    const now = input.now ?? new Date();
    const staleBefore = input.staleBefore ?? new Date(now.getTime() - 60_000);
    const limit = input.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('Email delivery claim limit must be a positive integer.');
    }

    return this.db.transaction((tx) => {
      const ready = or(
        and(
          eq(emailDeliveries.status, 'pending'),
          lte(emailDeliveries.nextAttemptAt, now),
        ),
        and(
          eq(emailDeliveries.status, 'delivering'),
          lte(emailDeliveries.updatedAt, staleBefore),
        ),
      );
      const filters = [ready];
      if (input.botInstanceId) {
        filters.push(eq(emailDeliveries.botInstanceId, input.botInstanceId));
      }
      if (input.source) {
        filters.push(eq(emailDeliveries.source, input.source));
      }

      const rows = tx.select().from(emailDeliveries)
        .where(and(...filters))
        .orderBy(asc(emailDeliveries.createdAt), asc(emailDeliveries.id))
        .limit(limit)
        .all();

      for (const row of rows) {
        tx.update(emailDeliveries).set({
          attemptCount: row.attemptCount + 1,
          lastError: null,
          status: 'delivering',
          updatedAt: now,
        }).where(eq(emailDeliveries.id, row.id)).run();
      }

      if (rows.length === 0) return [];
      return tx.select().from(emailDeliveries)
        .where(inArray(emailDeliveries.id, rows.map((row) => row.id)))
        .orderBy(asc(emailDeliveries.createdAt), asc(emailDeliveries.id))
        .all();
    }, { behavior: 'immediate' });
  }

  async markSent(id: string, sentAt: Date = new Date()): Promise<void> {
    this.db.update(emailDeliveries).set({
      lastError: null,
      sentAt,
      status: 'sent',
      updatedAt: sentAt,
    }).where(and(
      eq(emailDeliveries.id, normalizeKey(id, 'delivery ID')),
      eq(emailDeliveries.status, 'delivering'),
    )).run();
  }

  async markAttemptFailed(input: {
    error: string;
    id: string;
    maxAttempts?: number;
    nextAttemptAt?: Date;
    updatedAt?: Date;
  }): Promise<EmailDeliveryStatus> {
    const id = normalizeKey(input.id, 'delivery ID');
    const maxAttempts = input.maxAttempts ?? 5;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new Error('Email delivery max attempts must be a positive integer.');
    }

    return this.db.transaction((tx) => {
      const row = tx.select().from(emailDeliveries)
        .where(eq(emailDeliveries.id, id)).get();
      if (!row) throw new Error(`Email delivery not found: ${id}`);
      if (row.status !== 'delivering') return row.status;

      const updatedAt = input.updatedAt ?? new Date();
      const status: EmailDeliveryStatus = row.attemptCount >= maxAttempts ? 'failed' : 'pending';
      tx.update(emailDeliveries).set({
        lastError: input.error.trim().slice(0, 1_000) || 'Unknown delivery failure.',
        nextAttemptAt: input.nextAttemptAt ?? updatedAt,
        status,
        updatedAt,
      }).where(and(
        eq(emailDeliveries.id, id),
        eq(emailDeliveries.status, 'delivering'),
      )).run();
      return status;
    }, { behavior: 'immediate' });
  }
}

function normalizeCreateInput(
  input: CreateEmailDeliveryInput,
  createdAt: Date,
): Omit<CreateEmailDeliveryInput, 'nextAttemptAt'> & { nextAttemptAt: Date } {
  return {
    botInstanceId: normalizeKey(input.botInstanceId, 'Bot instance ID'),
    createdByUserId: normalizeNullableKey(input.createdByUserId),
    id: normalizeKey(input.id, 'delivery ID'),
    message: input.message,
    nextAttemptAt: input.nextAttemptAt ?? createdAt,
    recipientEmail: normalizeRecipientEmail(input.recipientEmail),
    recipientUserId: normalizeNullableKey(input.recipientUserId),
    semanticKey: normalizeKey(input.semanticKey, 'semantic key'),
    source: normalizeSource(input.source),
    subject: normalizeRequiredText(input.subject, 'subject'),
  };
}

function sameIdentity(
  row: EmailDeliveryRecord,
  input: ReturnType<typeof normalizeCreateInput>,
): boolean {
  return (row.id === input.id || row.semanticKey === input.semanticKey)
    && row.semanticKey === input.semanticKey
    && row.source === input.source
    && row.botInstanceId === input.botInstanceId
    && row.recipientUserId === input.recipientUserId
    && row.recipientEmail === input.recipientEmail
    && row.createdByUserId === input.createdByUserId
    && row.subject === input.subject
    && row.message === input.message;
}

function normalizeKey(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 500) {
    throw new Error(`Invalid email delivery ${label}.`);
  }
  return normalized;
}

function normalizeNullableKey(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeRecipientEmail(value: string): string {
  return normalizeRequiredText(value, 'recipient email').toLowerCase();
}

function normalizeRequiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Email delivery ${label} must not be empty.`);
  return normalized;
}

function normalizeSource(value: EmailDeliverySource): EmailDeliverySource {
  if (!EMAIL_DELIVERY_SOURCES.includes(value)) {
    throw new Error('Email delivery source is invalid.');
  }
  return value;
}
