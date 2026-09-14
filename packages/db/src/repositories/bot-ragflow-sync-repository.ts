import { asc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { botInstances } from '../schema/bot-instances';
import { botRagflowSyncStates, type RagflowSyncStatus } from '../schema/bot-ragflow-sync-states';
import { globalRagflowConfigs, GLOBAL_RAGFLOW_CONFIG_ID } from '../schema/global-ragflow-configs';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;

export interface BotRagflowSyncRecord {
  appliedRevision: number;
  botInstanceId: string;
  createdAt: Date;
  lastSyncError: string | null;
  lastSyncedAt: Date | null;
  syncStatus: RagflowSyncStatus;
  updatedAt: Date;
}

export class BotRagflowSyncRepository {
  constructor(private readonly db: Db) {}

  async listAll(): Promise<BotRagflowSyncRecord[]> {
    return this.db.select().from(botRagflowSyncStates)
      .orderBy(asc(botRagflowSyncStates.createdAt), asc(botRagflowSyncStates.botInstanceId))
      .all();
  }

  async ensureForAllBots(createdAt: Date = new Date()): Promise<BotRagflowSyncRecord[]> {
    const bots = this.db.select({ id: botInstances.id }).from(botInstances).all();
    if (bots.length > 0) {
      this.db.insert(botRagflowSyncStates)
        .values(bots.map(({ id }) => ({ botInstanceId: id, createdAt, updatedAt: createdAt })))
        .onConflictDoNothing({ target: botRagflowSyncStates.botInstanceId })
        .run();
    }
    return this.listAll();
  }

  async markSyncSucceeded(
    botInstanceId: string,
    appliedRevision: number,
    lastSyncedAt: Date = new Date(),
  ): Promise<void> {
    this.db.transaction((tx) => {
      const config = tx.select({ revision: globalRagflowConfigs.revision })
        .from(globalRagflowConfigs)
        .where(eq(globalRagflowConfigs.id, GLOBAL_RAGFLOW_CONFIG_ID))
        .get();
      if (!config || appliedRevision > config.revision) {
        throw new Error('Applied RAGFlow revision cannot exceed the global revision.');
      }
      tx.update(botRagflowSyncStates)
        .set({
          appliedRevision,
          lastSyncError: null,
          lastSyncedAt,
          syncStatus: appliedRevision === config.revision ? 'synced' : 'pending',
          updatedAt: lastSyncedAt,
        })
        .where(eq(botRagflowSyncStates.botInstanceId, botInstanceId))
        .run();
    }, { behavior: 'immediate' });
  }

  async markSyncFailed(
    botInstanceId: string,
    error: string,
    lastSyncedAt: Date = new Date(),
  ): Promise<void> {
    this.db.update(botRagflowSyncStates)
      .set({
        lastSyncError: error.trim() || 'Unknown RAGFlow projection error.',
        lastSyncedAt,
        syncStatus: 'error',
        updatedAt: lastSyncedAt,
      })
      .where(eq(botRagflowSyncStates.botInstanceId, botInstanceId))
      .run();
  }
}
