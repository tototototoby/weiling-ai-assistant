import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { botDifySyncStates } from '../schema/bot-dify-sync-states';
import {
  globalDifyConfigs,
  GLOBAL_DIFY_CONFIG_ID,
  type DifyTestStatus,
} from '../schema/global-dify-configs';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;

export interface GlobalDifyConfigRecord {
  apiBaseUrl: string;
  apiKey: string;
  appName: string;
  createdAt: Date;
  enabled: boolean;
  id: string;
  lastTestError: string | null;
  lastTestStatus: DifyTestStatus;
  lastTestedAt: Date | null;
  revision: number;
  updatedAt: Date;
  updatedByUserId: string | null;
}

export interface UpdateGlobalDifyConfigInput {
  apiBaseUrl: string;
  apiKey?: string;
  appName: string;
  enabled: boolean;
  updatedAt?: Date;
  updatedByUserId: string;
}

export class GlobalDifyConfigRepository {
  constructor(private readonly db: Db) {}

  async find(): Promise<GlobalDifyConfigRecord | null> {
    return this.db.select()
      .from(globalDifyConfigs)
      .where(eq(globalDifyConfigs.id, GLOBAL_DIFY_CONFIG_ID))
      .get() ?? null;
  }

  async ensure(createdAt: Date = new Date()): Promise<GlobalDifyConfigRecord> {
    this.db.insert(globalDifyConfigs)
      .values({
        createdAt,
        id: GLOBAL_DIFY_CONFIG_ID,
        updatedAt: createdAt,
      })
      .onConflictDoNothing({ target: globalDifyConfigs.id })
      .run();

    const config = await this.find();
    if (!config) throw new Error('Failed to ensure global Dify config.');
    return config;
  }

  async update(input: UpdateGlobalDifyConfigInput): Promise<GlobalDifyConfigRecord> {
    validateConfig(input);

    return this.db.transaction((tx) => {
      const current = tx.select()
        .from(globalDifyConfigs)
        .where(eq(globalDifyConfigs.id, GLOBAL_DIFY_CONFIG_ID))
        .get();

      if (!current) throw new Error('Global Dify config must be initialized before update.');

      const next = {
        apiBaseUrl: normalizeBaseUrl(input.apiBaseUrl),
        apiKey: input.apiKey?.trim() || current.apiKey,
        appName: input.appName.trim(),
        enabled: input.enabled,
      };
      const changed = next.apiBaseUrl !== current.apiBaseUrl
        || next.apiKey !== current.apiKey
        || next.appName !== current.appName
        || next.enabled !== current.enabled;

      if (!changed) return current;
      if (next.enabled && !next.apiKey) throw new Error('Dify API key is required when integration is enabled.');

      const updatedAt = input.updatedAt ?? new Date();
      tx.update(globalDifyConfigs)
        .set({
          ...next,
          lastTestError: null,
          lastTestStatus: 'untested',
          lastTestedAt: null,
          revision: current.revision + 1,
          updatedAt,
          updatedByUserId: input.updatedByUserId,
        })
        .where(eq(globalDifyConfigs.id, GLOBAL_DIFY_CONFIG_ID))
        .run();
      tx.update(botDifySyncStates)
        .set({ lastSyncError: null, syncStatus: 'pending', updatedAt })
        .run();

      return tx.select()
        .from(globalDifyConfigs)
        .where(eq(globalDifyConfigs.id, GLOBAL_DIFY_CONFIG_ID))
        .get()!;
    }, { behavior: 'immediate' });
  }

  async recordTestResult(input: {
    error?: string | null;
    status: Exclude<DifyTestStatus, 'untested'>;
    testedAt?: Date;
  }): Promise<GlobalDifyConfigRecord | null> {
    const testedAt = input.testedAt ?? new Date();
    this.db.update(globalDifyConfigs)
      .set({
        lastTestError: input.error?.trim() || null,
        lastTestStatus: input.status,
        lastTestedAt: testedAt,
        updatedAt: testedAt,
      })
      .where(eq(globalDifyConfigs.id, GLOBAL_DIFY_CONFIG_ID))
      .run();
    return this.find();
  }
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function validateConfig(input: UpdateGlobalDifyConfigInput): void {
  const baseUrl = normalizeBaseUrl(input.apiBaseUrl);
  if (input.enabled && !baseUrl) throw new Error('Dify API base URL is required when integration is enabled.');
  if (!input.appName.trim()) throw new Error('Dify application name must not be empty.');
  if (baseUrl) {
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Dify API base URL must use HTTP or HTTPS.');
    }
  }
}
