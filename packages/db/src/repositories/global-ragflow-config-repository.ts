import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { botRagflowSyncStates } from '../schema/bot-ragflow-sync-states';
import {
  globalRagflowConfigs,
  GLOBAL_RAGFLOW_CONFIG_ID,
  type RagflowTestStatus,
} from '../schema/global-ragflow-configs';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;

export interface GlobalRagflowConfigRecord {
  apiBaseUrl: string;
  apiKey: string;
  createdAt: Date;
  datasetIds: string[];
  enabled: boolean;
  id: string;
  knowledgeBaseName: string;
  lastTestError: string | null;
  lastTestStatus: RagflowTestStatus;
  lastTestedAt: Date | null;
  revision: number;
  updatedAt: Date;
  updatedByUserId: string | null;
}

export interface UpdateGlobalRagflowConfigInput {
  apiBaseUrl: string;
  apiKey?: string;
  datasetIds: readonly string[];
  enabled: boolean;
  knowledgeBaseName: string;
  updatedAt?: Date;
  updatedByUserId: string;
}

export class GlobalRagflowConfigRepository {
  constructor(private readonly db: Db) {}

  async find(): Promise<GlobalRagflowConfigRecord | null> {
    const row = this.db.select()
      .from(globalRagflowConfigs)
      .where(eq(globalRagflowConfigs.id, GLOBAL_RAGFLOW_CONFIG_ID))
      .get();
    return row ? mapRecord(row) : null;
  }

  async ensure(createdAt: Date = new Date()): Promise<GlobalRagflowConfigRecord> {
    this.db.insert(globalRagflowConfigs)
      .values({
        createdAt,
        id: GLOBAL_RAGFLOW_CONFIG_ID,
        updatedAt: createdAt,
      })
      .onConflictDoNothing({ target: globalRagflowConfigs.id })
      .run();

    const config = await this.find();
    if (!config) throw new Error('Failed to ensure global RAGFlow config.');
    return config;
  }

  async update(input: UpdateGlobalRagflowConfigInput): Promise<GlobalRagflowConfigRecord> {
    const normalized = normalizeConfig(input);
    validateConfig(normalized);

    return this.db.transaction((tx) => {
      const current = tx.select()
        .from(globalRagflowConfigs)
        .where(eq(globalRagflowConfigs.id, GLOBAL_RAGFLOW_CONFIG_ID))
        .get();

      if (!current) throw new Error('Global RAGFlow config must be initialized before update.');

      const next = {
        apiBaseUrl: normalized.apiBaseUrl,
        apiKey: normalized.apiKey || current.apiKey,
        datasetIdsJson: JSON.stringify(normalized.datasetIds),
        enabled: normalized.enabled,
        knowledgeBaseName: normalized.knowledgeBaseName,
      };
      const changed = next.apiBaseUrl !== current.apiBaseUrl
        || next.apiKey !== current.apiKey
        || next.datasetIdsJson !== current.datasetIdsJson
        || next.enabled !== current.enabled
        || next.knowledgeBaseName !== current.knowledgeBaseName;

      if (!changed) return mapRecord(current);
      if (next.enabled && !next.apiKey) {
        throw new Error('RAGFlow API key is required when integration is enabled.');
      }

      const updatedAt = input.updatedAt ?? new Date();
      tx.update(globalRagflowConfigs)
        .set({
          ...next,
          lastTestError: null,
          lastTestStatus: 'untested',
          lastTestedAt: null,
          revision: current.revision + 1,
          updatedAt,
          updatedByUserId: input.updatedByUserId,
        })
        .where(eq(globalRagflowConfigs.id, GLOBAL_RAGFLOW_CONFIG_ID))
        .run();
      tx.update(botRagflowSyncStates)
        .set({ lastSyncError: null, syncStatus: 'pending', updatedAt })
        .run();

      return mapRecord(tx.select()
        .from(globalRagflowConfigs)
        .where(eq(globalRagflowConfigs.id, GLOBAL_RAGFLOW_CONFIG_ID))
        .get()!);
    }, { behavior: 'immediate' });
  }

  async recordTestResult(input: {
    error?: string | null;
    status: Exclude<RagflowTestStatus, 'untested'>;
    testedAt?: Date;
  }): Promise<GlobalRagflowConfigRecord | null> {
    const testedAt = input.testedAt ?? new Date();
    this.db.update(globalRagflowConfigs)
      .set({
        lastTestError: input.error?.trim() || null,
        lastTestStatus: input.status,
        lastTestedAt: testedAt,
        updatedAt: testedAt,
      })
      .where(eq(globalRagflowConfigs.id, GLOBAL_RAGFLOW_CONFIG_ID))
      .run();
    return this.find();
  }
}

function mapRecord(row: typeof globalRagflowConfigs.$inferSelect): GlobalRagflowConfigRecord {
  return {
    ...row,
    datasetIds: parseDatasetIds(row.datasetIdsJson),
  };
}

function normalizeConfig(input: UpdateGlobalRagflowConfigInput) {
  return {
    apiBaseUrl: input.apiBaseUrl.trim().replace(/\/+$/, ''),
    apiKey: input.apiKey?.trim() || '',
    datasetIds: [...new Set(input.datasetIds.map((value) => value.trim()).filter(Boolean))].sort(),
    enabled: input.enabled,
    knowledgeBaseName: input.knowledgeBaseName.trim(),
  };
}

function parseDatasetIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
      throw new Error('RAGFlow dataset IDs must be a JSON string array.');
    }
    return parsed;
  } catch (error) {
    throw new Error(`Stored RAGFlow dataset IDs are invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateConfig(input: ReturnType<typeof normalizeConfig>): void {
  if (input.enabled && !input.apiBaseUrl) {
    throw new Error('RAGFlow API base URL is required when integration is enabled.');
  }
  if (input.enabled && input.datasetIds.length === 0) {
    throw new Error('At least one RAGFlow dataset ID is required when integration is enabled.');
  }
  if (!input.knowledgeBaseName) throw new Error('RAGFlow knowledge base name must not be empty.');
  if (input.apiBaseUrl) {
    const parsed = new URL(input.apiBaseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('RAGFlow API base URL must use HTTP or HTTPS.');
    }
  }
}
