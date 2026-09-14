import { asc, eq, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { botInstances } from '../schema/bot-instances';
import {
  botMorningBriefingPolicies,
  type MorningBriefingSyncStatus,
} from '../schema/bot-morning-briefing-policies';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;
type MorningBriefingPolicyRow = typeof botMorningBriefingPolicies.$inferSelect;

const DELIVERY_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export interface MorningBriefingPolicyRecord {
  adminEnabled: boolean;
  appliedRevision: number;
  botInstanceId: string;
  centralLastDeliveredAt: Date | null;
  centralLastDeliveryDate: string | null;
  centralLastError: string | null;
  centralScheduledFor: string | null;
  createdAt: Date;
  deliveryTime: string;
  desiredRevision: number;
  forceEnabled: boolean;
  lastSyncError: string | null;
  lastSyncedAt: Date | null;
  location: string;
  observedUserOptOut: boolean;
  runtimeNeedsCleanup: boolean;
  runtimeNeedsSchedule: boolean;
  runtimeObservedAt: Date | null;
  runtimeScheduledFor: string | null;
  runtimeScheduleTaskId: string | null;
  syncStatus: MorningBriefingSyncStatus;
  timezone: string;
  updatedAt: Date;
}

export interface MorningBriefingPolicyPatch {
  adminEnabled?: boolean;
  deliveryTime?: string;
  forceEnabled?: boolean;
  location?: string;
  timezone?: string;
  updatedAt?: Date;
}

export interface MarkMorningBriefingSyncSucceededInput {
  appliedRevision: number;
  lastSyncedAt?: Date;
  observedUserOptOut: boolean;
  runtimeNeedsCleanup: boolean;
  runtimeNeedsSchedule: boolean;
  runtimeScheduledFor: string | null;
  runtimeScheduleTaskId: string | null;
}

export interface MarkMorningBriefingSyncFailedInput {
  error: string;
  lastSyncedAt?: Date;
}

export interface MarkMorningBriefingDeliverySucceededInput {
  deliveredAt?: Date;
  deliveryDate: string;
  nextScheduledFor: string;
}

export interface MarkMorningBriefingDeliveryFailedInput {
  deliveryDate: string;
  error: string;
  failedAt?: Date;
  nextScheduledFor: string;
}

export class MorningBriefingPolicyRepository {
  constructor(private readonly db: Db) {}

  async listAll(): Promise<MorningBriefingPolicyRecord[]> {
    return this.db.select()
      .from(botMorningBriefingPolicies)
      .orderBy(
        asc(botMorningBriefingPolicies.createdAt),
        asc(botMorningBriefingPolicies.botInstanceId),
      )
      .all()
      .map(mapRow);
  }

  async findByBotId(botInstanceId: string): Promise<MorningBriefingPolicyRecord | null> {
    const row = this.db.select()
      .from(botMorningBriefingPolicies)
      .where(eq(botMorningBriefingPolicies.botInstanceId, botInstanceId))
      .get();

    return row ? mapRow(row) : null;
  }

  async ensureForBot(
    botInstanceId: string,
    createdAt: Date = new Date(),
  ): Promise<MorningBriefingPolicyRecord> {
    this.db.insert(botMorningBriefingPolicies)
      .values({
        botInstanceId,
        createdAt,
        updatedAt: createdAt,
      })
      .onConflictDoNothing({ target: botMorningBriefingPolicies.botInstanceId })
      .run();

    const policy = await this.findByBotId(botInstanceId);

    if (!policy) {
      throw new Error('Failed to ensure morning briefing policy.');
    }

    return policy;
  }

  async ensureForAllBots(createdAt: Date = new Date()): Promise<MorningBriefingPolicyRecord[]> {
    const botRows = this.db.select({ id: botInstances.id })
      .from(botInstances)
      .orderBy(asc(botInstances.createdAt), asc(botInstances.id))
      .all();

    if (botRows.length > 0) {
      this.db.insert(botMorningBriefingPolicies)
        .values(botRows.map(({ id }) => ({
          botInstanceId: id,
          createdAt,
          updatedAt: createdAt,
        })))
        .onConflictDoNothing({ target: botMorningBriefingPolicies.botInstanceId })
        .run();
    }

    return this.listAll();
  }

  async patchForBot(
    botInstanceId: string,
    input: MorningBriefingPolicyPatch,
  ): Promise<MorningBriefingPolicyRecord | null> {
    validatePatch(input);

    return this.db.transaction((tx) => {
      const current = tx.select()
        .from(botMorningBriefingPolicies)
        .where(eq(botMorningBriefingPolicies.botInstanceId, botInstanceId))
        .get();

      if (!current) {
        return null;
      }

      const values = getDesiredPatchValues(current, input);

      if (!values) {
        return mapRow(current);
      }

      tx.update(botMorningBriefingPolicies)
        .set(values)
        .where(eq(botMorningBriefingPolicies.botInstanceId, botInstanceId))
        .run();

      const updated = tx.select()
        .from(botMorningBriefingPolicies)
        .where(eq(botMorningBriefingPolicies.botInstanceId, botInstanceId))
        .get();

      return updated ? mapRow(updated) : null;
    }, { behavior: 'immediate' });
  }

  async bulkPatch(
    botInstanceIds: readonly string[],
    input: MorningBriefingPolicyPatch,
  ): Promise<MorningBriefingPolicyRecord[]> {
    validatePatch(input);
    const uniqueBotIds = [...new Set(botInstanceIds)];

    if (uniqueBotIds.length === 0) {
      return [];
    }

    return this.db.transaction((tx) => {
      const createdAt = input.updatedAt ?? new Date();

      tx.insert(botMorningBriefingPolicies)
        .values(uniqueBotIds.map((botInstanceId) => ({
          botInstanceId,
          createdAt,
          updatedAt: createdAt,
        })))
        .onConflictDoNothing({ target: botMorningBriefingPolicies.botInstanceId })
        .run();

      for (const botInstanceId of uniqueBotIds) {
        const current = tx.select()
          .from(botMorningBriefingPolicies)
          .where(eq(botMorningBriefingPolicies.botInstanceId, botInstanceId))
          .get();

        if (!current) {
          continue;
        }

        const values = getDesiredPatchValues(current, input);

        if (values) {
          tx.update(botMorningBriefingPolicies)
            .set(values)
            .where(eq(botMorningBriefingPolicies.botInstanceId, botInstanceId))
            .run();
        }
      }

      return tx.select()
        .from(botMorningBriefingPolicies)
        .where(inArray(botMorningBriefingPolicies.botInstanceId, uniqueBotIds))
        .orderBy(
          asc(botMorningBriefingPolicies.createdAt),
          asc(botMorningBriefingPolicies.botInstanceId),
        )
        .all()
        .map(mapRow);
    }, { behavior: 'immediate' });
  }

  async bulkPatchAll(input: MorningBriefingPolicyPatch): Promise<MorningBriefingPolicyRecord[]> {
    const policies = await this.ensureForAllBots(input.updatedAt);
    return this.bulkPatch(policies.map((policy) => policy.botInstanceId), input);
  }

  async markObservedUserOptOut(
    botInstanceId: string,
    observedUserOptOut: boolean,
    observedAt: Date = new Date(),
  ): Promise<MorningBriefingPolicyRecord | null> {
    this.db.update(botMorningBriefingPolicies)
      .set({
        ...(observedUserOptOut ? { centralScheduledFor: null } : {}),
        observedUserOptOut,
        updatedAt: observedAt,
      })
      .where(eq(botMorningBriefingPolicies.botInstanceId, botInstanceId))
      .run();

    return this.findByBotId(botInstanceId);
  }

  async markSyncSucceeded(
    botInstanceId: string,
    input: MarkMorningBriefingSyncSucceededInput,
  ): Promise<MorningBriefingPolicyRecord | null> {
    validateRevision(input.appliedRevision);
    validateRuntimeObservation(input);

    return this.db.transaction((tx) => {
      const current = tx.select()
        .from(botMorningBriefingPolicies)
        .where(eq(botMorningBriefingPolicies.botInstanceId, botInstanceId))
        .get();

      if (!current) {
        return null;
      }

      if (input.appliedRevision > current.desiredRevision) {
        throw new Error('Applied morning briefing revision cannot exceed desired revision.');
      }

      if (input.appliedRevision < current.appliedRevision) {
        throw new Error('Applied morning briefing revision cannot move backwards.');
      }

      const lastSyncedAt = input.lastSyncedAt ?? new Date();
      tx.update(botMorningBriefingPolicies)
        .set({
          appliedRevision: input.appliedRevision,
          lastSyncError: null,
          lastSyncedAt,
          observedUserOptOut: input.observedUserOptOut,
          runtimeNeedsCleanup: input.runtimeNeedsCleanup,
          runtimeNeedsSchedule: input.runtimeNeedsSchedule,
          runtimeObservedAt: lastSyncedAt,
          runtimeScheduledFor: input.runtimeScheduledFor,
          runtimeScheduleTaskId: input.runtimeScheduleTaskId,
          syncStatus: input.appliedRevision === current.desiredRevision ? 'synced' : 'pending',
          updatedAt: lastSyncedAt,
        })
        .where(eq(botMorningBriefingPolicies.botInstanceId, botInstanceId))
        .run();

      const updated = tx.select()
        .from(botMorningBriefingPolicies)
        .where(eq(botMorningBriefingPolicies.botInstanceId, botInstanceId))
        .get();

      return updated ? mapRow(updated) : null;
    }, { behavior: 'immediate' });
  }

  async markSyncFailed(
    botInstanceId: string,
    input: MarkMorningBriefingSyncFailedInput,
  ): Promise<MorningBriefingPolicyRecord | null> {
    const error = input.error.trim();

    if (!error) {
      throw new Error('Morning briefing sync error must not be empty.');
    }

    const lastSyncedAt = input.lastSyncedAt ?? new Date();
    this.db.update(botMorningBriefingPolicies)
      .set({
        lastSyncError: error,
        lastSyncedAt,
        syncStatus: 'error',
        updatedAt: lastSyncedAt,
      })
      .where(eq(botMorningBriefingPolicies.botInstanceId, botInstanceId))
      .run();

    return this.findByBotId(botInstanceId);
  }

  async updateCentralSchedule(
    botInstanceId: string,
    scheduledFor: string | null,
    updatedAt: Date = new Date(),
  ): Promise<MorningBriefingPolicyRecord | null> {
    validateScheduledFor(scheduledFor);
    this.db.update(botMorningBriefingPolicies)
      .set({
        centralLastError: null,
        centralScheduledFor: scheduledFor,
        updatedAt,
      })
      .where(eq(botMorningBriefingPolicies.botInstanceId, botInstanceId))
      .run();

    return this.findByBotId(botInstanceId);
  }

  async markCentralDeliverySucceeded(
    botInstanceId: string,
    input: MarkMorningBriefingDeliverySucceededInput,
  ): Promise<MorningBriefingPolicyRecord | null> {
    validateDeliveryDate(input.deliveryDate);
    validateScheduledFor(input.nextScheduledFor);
    const deliveredAt = input.deliveredAt ?? new Date();

    this.db.update(botMorningBriefingPolicies)
      .set({
        centralLastDeliveredAt: deliveredAt,
        centralLastDeliveryDate: input.deliveryDate,
        centralLastError: null,
        centralScheduledFor: input.nextScheduledFor,
        updatedAt: deliveredAt,
      })
      .where(eq(botMorningBriefingPolicies.botInstanceId, botInstanceId))
      .run();

    return this.findByBotId(botInstanceId);
  }

  async markCentralDeliveryFailed(
    botInstanceId: string,
    input: MarkMorningBriefingDeliveryFailedInput,
  ): Promise<MorningBriefingPolicyRecord | null> {
    const error = input.error.trim();

    if (!error) {
      throw new Error('Morning briefing delivery error must not be empty.');
    }

    validateScheduledFor(input.nextScheduledFor);
    const failedAt = input.failedAt ?? new Date();
    this.db.update(botMorningBriefingPolicies)
      .set({
        centralLastDeliveryDate: input.deliveryDate,
        centralLastError: error,
        centralScheduledFor: input.nextScheduledFor,
        updatedAt: failedAt,
      })
      .where(eq(botMorningBriefingPolicies.botInstanceId, botInstanceId))
      .run();

    return this.findByBotId(botInstanceId);
  }
}

function getDesiredPatchValues(
  current: MorningBriefingPolicyRow,
  input: MorningBriefingPolicyPatch,
): Partial<typeof botMorningBriefingPolicies.$inferInsert> | null {
  const next = {
    adminEnabled: input.adminEnabled ?? current.adminEnabled,
    deliveryTime: input.deliveryTime ?? current.deliveryTime,
    forceEnabled: input.forceEnabled ?? current.forceEnabled,
    location: input.location?.trim() ?? current.location,
    timezone: input.timezone?.trim() ?? current.timezone,
  };
  const changed = next.adminEnabled !== current.adminEnabled
    || next.deliveryTime !== current.deliveryTime
    || next.forceEnabled !== current.forceEnabled
    || next.location !== current.location
    || next.timezone !== current.timezone;

  if (!changed) {
    return null;
  }

  return {
    ...next,
    centralLastError: null,
    centralScheduledFor: null,
    desiredRevision: current.desiredRevision + 1,
    lastSyncError: null,
    syncStatus: 'pending',
    updatedAt: input.updatedAt ?? new Date(),
  };
}

function validatePatch(input: MorningBriefingPolicyPatch): void {
  if (input.deliveryTime !== undefined && !DELIVERY_TIME_PATTERN.test(input.deliveryTime)) {
    throw new Error('Morning briefing deliveryTime must use HH:mm in 24-hour time.');
  }

  if (input.location !== undefined && !input.location.trim()) {
    throw new Error('Morning briefing location must not be empty.');
  }

  if (input.timezone !== undefined && !input.timezone.trim()) {
    throw new Error('Morning briefing timezone must not be empty.');
  }
}

function validateRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error('Applied morning briefing revision must be a non-negative integer.');
  }
}

function validateRuntimeObservation(
  input: Pick<
    MarkMorningBriefingSyncSucceededInput,
    'runtimeScheduledFor' | 'runtimeScheduleTaskId'
  >,
): void {
  if (input.runtimeScheduleTaskId !== null) {
    const taskId = input.runtimeScheduleTaskId.trim();

    if (!taskId || taskId.length > 200) {
      throw new Error('Morning briefing runtime schedule task id is invalid.');
    }
  }

  if (
    input.runtimeScheduledFor !== null
    && !Number.isFinite(Date.parse(input.runtimeScheduledFor))
  ) {
    throw new Error('Morning briefing runtime scheduled time is invalid.');
  }
}

function validateScheduledFor(value: string | null): void {
  if (value !== null && !Number.isFinite(Date.parse(value))) {
    throw new Error('Morning briefing central scheduled time is invalid.');
  }
}

function validateDeliveryDate(value: string): void {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00Z`)
    : null;
  if (!parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('Morning briefing delivery date is invalid.');
  }
}

function mapRow(row: MorningBriefingPolicyRow): MorningBriefingPolicyRecord {
  return row;
}
