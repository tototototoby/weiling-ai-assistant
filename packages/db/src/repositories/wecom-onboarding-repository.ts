import { normalizeEmployeeLookupName } from '@weiling-ai/shared';
import { and, desc, eq, or } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { botInstances } from '../schema/bot-instances';
import { botWecomBindings } from '../schema/bot-wecom-bindings';
import { employeeDirectoryEntries } from '../schema/employee-directory-entries';
import { wecomOnboardingReceipts } from '../schema/wecom-onboarding-receipts';
import { wecomOnboardingSessions } from '../schema/wecom-onboarding-sessions';
import type * as schema from '../schema/index';

const SESSION_TTL_MS = 15 * 60_000;
const MAX_FAILED_ATTEMPTS = 5;
const COOLDOWN_MS = 10 * 60_000;

type Db = BetterSQLite3Database<typeof schema>;
type SessionRow = typeof wecomOnboardingSessions.$inferSelect;

export interface WecomOnboardingSessionRecord extends SessionRow {
  failedAttemptCount: number;
}

export type WecomOnboardingReceiptClaimResult =
  | { status: 'claimed' }
  | { status: 'processing' }
  | { response: string; status: 'completed' };

export type WecomOnboardingReceiptReplayResult =
  | { status: 'processing' }
  | { response: string; status: 'completed' };

export type WecomOnboardingBindFailureOutcome =
  | 'ambiguous'
  | 'bot_conflict'
  | 'bot_missing'
  | 'disabled'
  | 'invalid_name'
  | 'not_found'
  | 'unclaimed'
  | 'userid_conflict';

type PublicBindFailureStatus = 'ambiguous' | 'disabled' | 'not_found';

export type WecomOnboardingBindResult =
  | {
    botInstanceId: string;
    outcome: 'already_bound' | 'bound';
    session: WecomOnboardingSessionRecord;
    status: 'bound';
  }
  | {
    outcome: WecomOnboardingBindFailureOutcome;
    session: WecomOnboardingSessionRecord;
    status: PublicBindFailureStatus;
  };

export class WecomOnboardingRepository {
  constructor(private readonly db: Db) {}

  async findReceipt(
    messageId: string,
    wecomUserId: string,
  ): Promise<WecomOnboardingReceiptReplayResult | null> {
    const normalizedMessageId = normalizeIdentifier(messageId, 500, 'message ID');
    const normalizedWecomUserId = normalizeIdentifier(wecomUserId, 128, 'user ID');
    const receipt = this.db.select().from(wecomOnboardingReceipts)
      .where(eq(wecomOnboardingReceipts.messageId, normalizedMessageId)).get();
    if (!receipt || receipt.wecomUserId !== normalizedWecomUserId) return null;
    if (receipt.status === 'completed') {
      return { response: receipt.response ?? '', status: 'completed' };
    }
    return { status: 'processing' };
  }

  async claimReceipt(input: {
    messageId: string;
    now?: Date;
    receivedAt?: Date;
    staleBefore?: Date;
    wecomUserId: string;
  }): Promise<WecomOnboardingReceiptClaimResult> {
    const messageId = normalizeIdentifier(input.messageId, 500, 'message ID');
    const wecomUserId = normalizeIdentifier(input.wecomUserId, 128, 'user ID');
    const now = input.now ?? input.receivedAt ?? new Date();
    const staleBefore = input.staleBefore ?? new Date(now.getTime() - 60_000);

    return this.db.transaction((tx) => {
      const inserted = tx.insert(wecomOnboardingReceipts).values({
        attemptCount: 1,
        messageId,
        receivedAt: now,
        updatedAt: now,
        wecomUserId,
      }).onConflictDoNothing({ target: wecomOnboardingReceipts.messageId }).run();
      if (inserted.changes === 1) return { status: 'claimed' };

      const existing = tx.select().from(wecomOnboardingReceipts)
        .where(eq(wecomOnboardingReceipts.messageId, messageId)).get();
      if (!existing) throw new Error('Failed to read existing WeCom onboarding receipt.');
      if (existing.wecomUserId !== wecomUserId) {
        throw new Error('WeCom onboarding receipt identity conflict.');
      }
      if (existing.status === 'completed') {
        return { response: existing.response ?? '', status: 'completed' };
      }
      if (existing.updatedAt.getTime() > staleBefore.getTime()) {
        return { status: 'processing' };
      }

      tx.update(wecomOnboardingReceipts).set({
        attemptCount: existing.attemptCount + 1,
        completedAt: null,
        error: null,
        response: null,
        status: 'processing',
        updatedAt: now,
      }).where(and(
        eq(wecomOnboardingReceipts.messageId, messageId),
        eq(wecomOnboardingReceipts.wecomUserId, wecomUserId),
      )).run();
      return { status: 'claimed' };
    }, { behavior: 'immediate' });
  }

  async completeReceipt(messageId: string, response: string, now: Date = new Date()): Promise<void> {
    const normalizedMessageId = normalizeIdentifier(messageId, 500, 'message ID');
    const normalizedResponse = normalizeResponse(response);
    this.db.update(wecomOnboardingReceipts).set({
      completedAt: now,
      error: null,
      response: normalizedResponse,
      status: 'completed',
      updatedAt: now,
    }).where(and(
      eq(wecomOnboardingReceipts.messageId, normalizedMessageId),
      eq(wecomOnboardingReceipts.status, 'processing'),
    )).run();
  }

  async beginOrGetSession(input: {
    expiresAt?: Date;
    now?: Date;
    startedAt?: Date;
    wecomUserId: string;
  }): Promise<{ created: boolean; session: WecomOnboardingSessionRecord }> {
    const wecomUserId = normalizeIdentifier(input.wecomUserId, 128, 'user ID');
    const now = input.now ?? input.startedAt ?? new Date();
    const expiresAt = input.expiresAt ?? new Date(now.getTime() + SESSION_TTL_MS);
    if (expiresAt <= now) throw new Error('Invalid WeCom onboarding session expiry.');

    return this.db.transaction((tx) => {
      const inserted = tx.insert(wecomOnboardingSessions).values({
        createdAt: now,
        expiresAt,
        lastPromptAt: now,
        updatedAt: now,
        wecomUserId,
      }).onConflictDoNothing({ target: wecomOnboardingSessions.wecomUserId }).run();
      let session = tx.select().from(wecomOnboardingSessions)
        .where(eq(wecomOnboardingSessions.wecomUserId, wecomUserId)).get();
      if (!session) throw new Error('Failed to begin WeCom onboarding session.');
      if (inserted.changes === 1) return { created: true, session: mapSession(session) };
      if (session.status === 'bound') {
        const activeBinding = tx.select({ botInstanceId: botWecomBindings.botInstanceId })
          .from(botWecomBindings)
          .where(and(
            eq(botWecomBindings.wecomUserId, wecomUserId),
            eq(botWecomBindings.enabled, true),
          )).get();
        if (activeBinding?.botInstanceId === session.botInstanceId) {
          return { created: false, session: mapSession(session) };
        }
        tx.update(wecomOnboardingSessions).set({
          attemptCount: 0,
          botInstanceId: null,
          boundAt: null,
          cooldownUntil: null,
          createdAt: now,
          employeeId: null,
          expiresAt,
          lastError: null,
          lastPromptAt: now,
          status: 'awaiting_name',
          updatedAt: now,
        }).where(eq(wecomOnboardingSessions.wecomUserId, wecomUserId)).run();
        return { created: true, session: mapSession(readSession(tx, wecomUserId)) };
      }

      if (session.expiresAt <= now) {
        tx.update(wecomOnboardingSessions).set({
          attemptCount: 0,
          cooldownUntil: null,
          expiresAt,
          lastError: null,
          lastPromptAt: now,
          updatedAt: now,
        }).where(eq(wecomOnboardingSessions.wecomUserId, wecomUserId)).run();
        session = readSession(tx, wecomUserId);
        return { created: true, session: mapSession(session) };
      }

      if (session.cooldownUntil && session.cooldownUntil <= now) {
        tx.update(wecomOnboardingSessions).set({
          attemptCount: 0,
          cooldownUntil: null,
          lastError: null,
          updatedAt: now,
        }).where(eq(wecomOnboardingSessions.wecomUserId, wecomUserId)).run();
        session = readSession(tx, wecomUserId);
      }
      return { created: false, session: mapSession(session) };
    }, { behavior: 'immediate' });
  }

  async recordFailedAttempt(input: {
    attemptedAt?: Date;
    cooldownUntil?: Date | null;
    error?: string;
    now?: Date;
    wecomUserId: string;
  }): Promise<WecomOnboardingSessionRecord> {
    const wecomUserId = normalizeIdentifier(input.wecomUserId, 128, 'user ID');
    const now = input.now ?? input.attemptedAt ?? new Date();
    const error = normalizeError(input.error, 'name_not_matched');

    return this.db.transaction((tx) => {
      tx.insert(wecomOnboardingSessions).values({
        createdAt: now,
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
        lastPromptAt: now,
        updatedAt: now,
        wecomUserId,
      }).onConflictDoNothing({ target: wecomOnboardingSessions.wecomUserId }).run();
      const existing = readSession(tx, wecomUserId);
      if (existing.status === 'bound') return mapSession(existing);
      if (existing.cooldownUntil && existing.cooldownUntil > now) return mapSession(existing);

      const expired = existing.expiresAt <= now;
      const cooldownElapsed = existing.cooldownUntil !== null && existing.cooldownUntil <= now;
      const nextAttemptCount = (expired || cooldownElapsed ? 0 : existing.attemptCount) + 1;
      const cooldownUntil = nextAttemptCount >= MAX_FAILED_ATTEMPTS
        ? new Date(now.getTime() + COOLDOWN_MS)
        : null;
      tx.update(wecomOnboardingSessions).set({
        attemptCount: nextAttemptCount,
        cooldownUntil,
        expiresAt: expired ? new Date(now.getTime() + SESSION_TTL_MS) : existing.expiresAt,
        lastError: error,
        updatedAt: now,
      }).where(and(
        eq(wecomOnboardingSessions.wecomUserId, wecomUserId),
        eq(wecomOnboardingSessions.status, 'awaiting_name'),
      )).run();
      return mapSession(readSession(tx, wecomUserId));
    }, { behavior: 'immediate' });
  }

  async bindByName(input: {
    boundAt?: Date;
    messageId: string;
    name?: string;
    now?: Date;
    submittedName?: string;
    successResponse: string;
    wecomUserId: string;
  }): Promise<WecomOnboardingBindResult> {
    const wecomUserId = normalizeIdentifier(input.wecomUserId, 128, 'user ID');
    const messageId = normalizeIdentifier(input.messageId, 500, 'message ID');
    const normalizedName = normalizeEmployeeLookupName(input.name ?? input.submittedName ?? '');
    const successResponse = normalizeResponse(input.successResponse);
    const now = input.now ?? input.boundAt ?? new Date();

    return this.db.transaction((tx) => {
      const receipt = tx.select().from(wecomOnboardingReceipts)
        .where(eq(wecomOnboardingReceipts.messageId, messageId)).get();
      if (!receipt || receipt.wecomUserId !== wecomUserId || receipt.status !== 'processing') {
        throw new Error('WeCom onboarding receipt is not claimable for binding.');
      }
      tx.insert(wecomOnboardingSessions).values({
        createdAt: now,
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
        lastPromptAt: now,
        updatedAt: now,
        wecomUserId,
      }).onConflictDoNothing({ target: wecomOnboardingSessions.wecomUserId }).run();
      const session = readSession(tx, wecomUserId);
      const existingForUser = tx.select().from(botWecomBindings)
        .where(eq(botWecomBindings.wecomUserId, wecomUserId)).get();

      if (!normalizedName) return bindFailure('invalid_name', mapSession(session));
      const matches = tx.select().from(employeeDirectoryEntries).where(or(
        eq(employeeDirectoryEntries.normalizedLegalName, normalizedName),
        eq(employeeDirectoryEntries.normalizedNickname, normalizedName),
      )).limit(2).all();

      if (matches.length > 1) return bindFailure('ambiguous', mapSession(session));
      if (matches.length === 0) return bindFailure('not_found', mapSession(session));
      const employee = matches[0];
      if (!employee.enabled) return bindFailure('disabled', mapSession(session));
      if (!employee.claimedBotInstanceId) return bindFailure('unclaimed', mapSession(session));

      const botInstanceId = employee.claimedBotInstanceId;
      const bot = tx.select({ id: botInstances.id }).from(botInstances)
        .where(eq(botInstances.id, botInstanceId)).get();
      if (!bot) return bindFailure('bot_missing', mapSession(session));

      const existingForBot = tx.select().from(botWecomBindings)
        .where(eq(botWecomBindings.botInstanceId, botInstanceId)).get();
      const existingSessionForBot = tx.select().from(wecomOnboardingSessions).where(and(
        eq(wecomOnboardingSessions.botInstanceId, botInstanceId),
        eq(wecomOnboardingSessions.status, 'bound'),
      )).get();

      if (existingForUser) {
        const exactBinding = existingForUser.botInstanceId === botInstanceId
          && existingForUser.employeeId === employee.id
          && existingForUser.enabled;
        if (!exactBinding) return bindFailure('userid_conflict', mapSession(session));
        const boundSession = setSessionBound(tx, {
          botInstanceId,
          boundAt: now,
          employeeId: employee.id,
          wecomUserId,
        });
        completeBinding(tx, {
          messageId,
          now,
          response: successResponse,
          wecomUserId,
        });
        return bindSuccess('already_bound', boundSession);
      }
      if (existingForBot || (
        existingSessionForBot
        && existingSessionForBot.wecomUserId !== wecomUserId
      )) {
        return bindFailure('bot_conflict', mapSession(session));
      }

      tx.insert(botWecomBindings).values({
        botInstanceId,
        createdAt: now,
        employeeId: employee.id,
        enabled: true,
        preferredForProactive: true,
        updatedAt: now,
        wecomUserId,
      }).run();
      const boundSession = setSessionBound(tx, {
        botInstanceId,
        boundAt: now,
        employeeId: employee.id,
        wecomUserId,
      });
      completeBinding(tx, {
        messageId,
        now,
        response: successResponse,
        wecomUserId,
      });
      return bindSuccess('bound', boundSession);
    }, { behavior: 'immediate' });
  }

  async listSessions(): Promise<WecomOnboardingSessionRecord[]> {
    return this.db.select().from(wecomOnboardingSessions)
      .orderBy(desc(wecomOnboardingSessions.updatedAt), desc(wecomOnboardingSessions.wecomUserId))
      .all()
      .map(mapSession);
  }

  async deleteSession(wecomUserId: string): Promise<boolean> {
    return this.db.delete(wecomOnboardingSessions)
      .where(eq(
        wecomOnboardingSessions.wecomUserId,
        normalizeIdentifier(wecomUserId, 128, 'user ID'),
      ))
      .run().changes > 0;
  }
}

function readSession(
  tx: Parameters<Parameters<Db['transaction']>[0]>[0],
  wecomUserId: string,
): SessionRow {
  const session = tx.select().from(wecomOnboardingSessions)
    .where(eq(wecomOnboardingSessions.wecomUserId, wecomUserId)).get();
  if (!session) throw new Error('Failed to read WeCom onboarding session.');
  return session;
}

function setSessionBound(
  tx: Parameters<Parameters<Db['transaction']>[0]>[0],
  input: {
    botInstanceId: string;
    boundAt: Date;
    employeeId: string;
    wecomUserId: string;
  },
): WecomOnboardingSessionRecord {
  tx.update(wecomOnboardingSessions).set({
    attemptCount: 0,
    botInstanceId: input.botInstanceId,
    boundAt: input.boundAt,
    cooldownUntil: null,
    employeeId: input.employeeId,
    lastError: null,
    status: 'bound',
    updatedAt: input.boundAt,
  }).where(and(
    eq(wecomOnboardingSessions.wecomUserId, input.wecomUserId),
    eq(wecomOnboardingSessions.status, 'awaiting_name'),
  )).run();
  return mapSession(readSession(tx, input.wecomUserId));
}

function completeBinding(
  tx: Parameters<Parameters<Db['transaction']>[0]>[0],
  input: {
    messageId: string;
    now: Date;
    response: string;
    wecomUserId: string;
  },
): void {
  const completed = tx.update(wecomOnboardingReceipts).set({
    completedAt: input.now,
    error: null,
    response: input.response,
    status: 'completed',
    updatedAt: input.now,
  }).where(and(
    eq(wecomOnboardingReceipts.messageId, input.messageId),
    eq(wecomOnboardingReceipts.wecomUserId, input.wecomUserId),
    eq(wecomOnboardingReceipts.status, 'processing'),
  )).run();
  if (completed.changes !== 1) {
    throw new Error('Failed to complete WeCom onboarding receipt during binding.');
  }
  tx.delete(wecomOnboardingSessions)
    .where(eq(wecomOnboardingSessions.wecomUserId, input.wecomUserId))
    .run();
}

function bindSuccess(
  outcome: 'already_bound' | 'bound',
  session: WecomOnboardingSessionRecord,
): WecomOnboardingBindResult {
  if (!session.botInstanceId) throw new Error('Bound onboarding session has no Bot.');
  return { botInstanceId: session.botInstanceId, outcome, session, status: 'bound' };
}

function bindFailure(
  outcome: WecomOnboardingBindFailureOutcome,
  session: WecomOnboardingSessionRecord,
): WecomOnboardingBindResult {
  const status: PublicBindFailureStatus = outcome === 'ambiguous'
    ? 'ambiguous'
    : outcome === 'disabled'
      ? 'disabled'
      : 'not_found';
  return { outcome, session, status };
}

function mapSession(session: SessionRow): WecomOnboardingSessionRecord {
  return { ...session, failedAttemptCount: session.attemptCount };
}

function normalizeIdentifier(value: string, maxLength: number, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`Invalid WeCom onboarding ${label}.`);
  }
  return normalized;
}

function normalizeError(value: string | null | undefined, fallback: string): string {
  return value?.trim().slice(0, 1000) || fallback;
}

function normalizeResponse(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 10_000) {
    throw new Error('Invalid WeCom onboarding response.');
  }
  return normalized;
}
