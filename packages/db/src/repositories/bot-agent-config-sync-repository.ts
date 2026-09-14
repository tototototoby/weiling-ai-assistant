import { asc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  botAgentConfigSyncStates,
  type AgentConfigSyncStatus,
} from '../schema/bot-agent-config-sync-states';
import { botInstances } from '../schema/bot-instances';
import { botAgentConfigOverrides } from '../schema/bot-agent-config-overrides';
import { globalAgentConfigs, GLOBAL_AGENT_CONFIG_ID } from '../schema/global-agent-configs';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;
type BotAgentConfigSyncRow = typeof botAgentConfigSyncStates.$inferSelect;

export interface BotAgentConfigSyncRecord {
  appliedOverrideRevision: number;
  appliedRevision: number;
  botInstanceId: string;
  createdAt: Date;
  lastSyncError: string | null;
  lastSyncedAt: Date | null;
  syncStatus: AgentConfigSyncStatus;
  updatedAt: Date;
}

export interface MarkAgentConfigSyncSucceededInput {
  appliedOverrideRevision: number;
  appliedRevision: number;
  lastSyncedAt?: Date;
}

export interface MarkAgentConfigSyncFailedInput {
  error: string;
  lastSyncedAt?: Date;
}

export class BotAgentConfigSyncRepository {
  constructor(private readonly db: Db) {}

  async listAll(): Promise<BotAgentConfigSyncRecord[]> {
    return this.db.select()
      .from(botAgentConfigSyncStates)
      .orderBy(
        asc(botAgentConfigSyncStates.createdAt),
        asc(botAgentConfigSyncStates.botInstanceId),
      )
      .all()
      .map(mapRow);
  }

  async findByBotId(botInstanceId: string): Promise<BotAgentConfigSyncRecord | null> {
    const row = this.db.select()
      .from(botAgentConfigSyncStates)
      .where(eq(botAgentConfigSyncStates.botInstanceId, botInstanceId))
      .get();

    return row ? mapRow(row) : null;
  }

  async ensureForBot(
    botInstanceId: string,
    createdAt: Date = new Date(),
  ): Promise<BotAgentConfigSyncRecord> {
    this.db.insert(botAgentConfigSyncStates)
      .values({ botInstanceId, createdAt, updatedAt: createdAt })
      .onConflictDoNothing({ target: botAgentConfigSyncStates.botInstanceId })
      .run();

    const state = await this.findByBotId(botInstanceId);

    if (!state) {
      throw new Error('Failed to ensure bot agent config sync state.');
    }

    return state;
  }

  async ensureForAllBots(createdAt: Date = new Date()): Promise<BotAgentConfigSyncRecord[]> {
    const bots = this.db.select({ id: botInstances.id })
      .from(botInstances)
      .orderBy(asc(botInstances.createdAt), asc(botInstances.id))
      .all();

    if (bots.length > 0) {
      this.db.insert(botAgentConfigSyncStates)
        .values(bots.map(({ id }) => ({
          botInstanceId: id,
          createdAt,
          updatedAt: createdAt,
        })))
        .onConflictDoNothing({ target: botAgentConfigSyncStates.botInstanceId })
        .run();
    }

    return this.listAll();
  }

  async markPendingForAll(updatedAt: Date = new Date()): Promise<BotAgentConfigSyncRecord[]> {
    this.db.update(botAgentConfigSyncStates)
      .set({
        lastSyncError: null,
        syncStatus: 'pending',
        updatedAt,
      })
      .run();

    return this.listAll();
  }

  async markPendingForBot(
    botInstanceId: string,
    updatedAt: Date = new Date(),
  ): Promise<BotAgentConfigSyncRecord | null> {
    await this.ensureForBot(botInstanceId, updatedAt);
    this.db.update(botAgentConfigSyncStates)
      .set({
        lastSyncError: null,
        syncStatus: 'pending',
        updatedAt,
      })
      .where(eq(botAgentConfigSyncStates.botInstanceId, botInstanceId))
      .run();

    return this.findByBotId(botInstanceId);
  }

  async markSyncSucceeded(
    botInstanceId: string,
    input: MarkAgentConfigSyncSucceededInput,
  ): Promise<BotAgentConfigSyncRecord | null> {
    validateRevision(input.appliedRevision);
    validateRevision(input.appliedOverrideRevision);

    return this.db.transaction((tx) => {
      const state = tx.select()
        .from(botAgentConfigSyncStates)
        .where(eq(botAgentConfigSyncStates.botInstanceId, botInstanceId))
        .get();

      if (!state) {
        return null;
      }

      const config = tx.select()
        .from(globalAgentConfigs)
        .where(eq(globalAgentConfigs.id, GLOBAL_AGENT_CONFIG_ID))
        .get();

      if (!config) {
        throw new Error('Global agent config must exist before recording sync success.');
      }

      if (input.appliedRevision > config.revision) {
        throw new Error('Applied agent config revision cannot exceed global revision.');
      }

      if (input.appliedRevision < state.appliedRevision) {
        throw new Error('Applied agent config revision cannot move backwards.');
      }

      const override = tx.select().from(botAgentConfigOverrides)
        .where(eq(botAgentConfigOverrides.botInstanceId, botInstanceId))
        .get();
      const currentOverrideRevision = override?.revision ?? 0;

      if (input.appliedOverrideRevision > currentOverrideRevision) {
        throw new Error('Applied Bot agent override revision cannot exceed the current revision.');
      }

      if (input.appliedOverrideRevision < state.appliedOverrideRevision) {
        throw new Error('Applied Bot agent override revision cannot move backwards.');
      }

      const lastSyncedAt = input.lastSyncedAt ?? new Date();
      tx.update(botAgentConfigSyncStates)
        .set({
          appliedOverrideRevision: input.appliedOverrideRevision,
          appliedRevision: input.appliedRevision,
          lastSyncError: null,
          lastSyncedAt,
          syncStatus: input.appliedRevision === config.revision
            && input.appliedOverrideRevision === currentOverrideRevision
            ? 'synced'
            : 'pending',
          updatedAt: lastSyncedAt,
        })
        .where(eq(botAgentConfigSyncStates.botInstanceId, botInstanceId))
        .run();

      const updated = tx.select()
        .from(botAgentConfigSyncStates)
        .where(eq(botAgentConfigSyncStates.botInstanceId, botInstanceId))
        .get();

      return updated ? mapRow(updated) : null;
    }, { behavior: 'immediate' });
  }

  async markSyncFailed(
    botInstanceId: string,
    input: MarkAgentConfigSyncFailedInput,
  ): Promise<BotAgentConfigSyncRecord | null> {
    const error = input.error.trim();

    if (!error) {
      throw new Error('Agent config sync error must not be empty.');
    }

    const lastSyncedAt = input.lastSyncedAt ?? new Date();
    this.db.update(botAgentConfigSyncStates)
      .set({
        lastSyncError: error,
        lastSyncedAt,
        syncStatus: 'error',
        updatedAt: lastSyncedAt,
      })
      .where(eq(botAgentConfigSyncStates.botInstanceId, botInstanceId))
      .run();

    return this.findByBotId(botInstanceId);
  }
}

function validateRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error('Applied agent config revision must be a non-negative integer.');
  }
}

function mapRow(row: BotAgentConfigSyncRow): BotAgentConfigSyncRecord {
  return row;
}
