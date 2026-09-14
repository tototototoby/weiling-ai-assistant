import { asc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { botDifySyncStates, type DifySyncStatus } from '../schema/bot-dify-sync-states';
import { botInstances } from '../schema/bot-instances';
import { globalDifyConfigs, GLOBAL_DIFY_CONFIG_ID } from '../schema/global-dify-configs';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;

export interface BotDifySyncRecord {
  appliedRevision: number;
  botInstanceId: string;
  createdAt: Date;
  lastSyncError: string | null;
  lastSyncedAt: Date | null;
  syncStatus: DifySyncStatus;
  updatedAt: Date;
}

export class BotDifySyncRepository {
  constructor(private readonly db: Db) {}

  async listAll(): Promise<BotDifySyncRecord[]> {
    return this.db.select().from(botDifySyncStates)
      .orderBy(asc(botDifySyncStates.createdAt), asc(botDifySyncStates.botInstanceId))
      .all();
  }

  async ensureForAllBots(createdAt: Date = new Date()): Promise<BotDifySyncRecord[]> {
    const bots = this.db.select({ id: botInstances.id }).from(botInstances).all();
    if (bots.length > 0) {
      this.db.insert(botDifySyncStates)
        .values(bots.map(({ id }) => ({ botInstanceId: id, createdAt, updatedAt: createdAt })))
        .onConflictDoNothing({ target: botDifySyncStates.botInstanceId })
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
      const config = tx.select({ revision: globalDifyConfigs.revision })
        .from(globalDifyConfigs)
        .where(eq(globalDifyConfigs.id, GLOBAL_DIFY_CONFIG_ID))
        .get();
      if (!config || appliedRevision > config.revision) {
        throw new Error('Applied Dify revision cannot exceed the global revision.');
      }
      tx.update(botDifySyncStates)
        .set({
          appliedRevision,
          lastSyncError: null,
          lastSyncedAt,
          syncStatus: appliedRevision === config.revision ? 'synced' : 'pending',
          updatedAt: lastSyncedAt,
        })
        .where(eq(botDifySyncStates.botInstanceId, botInstanceId))
        .run();
    }, { behavior: 'immediate' });
  }

  async markSyncFailed(
    botInstanceId: string,
    error: string,
    lastSyncedAt: Date = new Date(),
  ): Promise<void> {
    this.db.update(botDifySyncStates)
      .set({
        lastSyncError: error.trim() || 'Unknown Dify projection error.',
        lastSyncedAt,
        syncStatus: 'error',
        updatedAt: lastSyncedAt,
      })
      .where(eq(botDifySyncStates.botInstanceId, botInstanceId))
      .run();
  }
}
