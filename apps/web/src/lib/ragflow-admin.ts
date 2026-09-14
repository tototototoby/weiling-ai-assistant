import { z } from 'zod';
import { ApiError } from './api-error';
import type { WebRepositories } from './repositories';

const datasetIdSchema = z.string().trim().min(1).max(200);

const configSchema = z.object({
  apiBaseUrl: z.string().trim().max(2_000),
  apiKey: z.string().trim().max(2_000).optional(),
  datasetIds: z.array(datasetIdSchema).max(100),
  enabled: z.boolean(),
  knowledgeBaseName: z.string().trim().min(1).max(100),
}).strict();

const testSchema = z.object({
  apiBaseUrl: z.string().trim().max(2_000).optional(),
  apiKey: z.string().trim().max(2_000).optional(),
  datasetIds: z.array(datasetIdSchema).max(100).optional(),
}).strict();

type RagflowAdminRepositories = Pick<
  WebRepositories,
  'botInstances' | 'botRagflowSyncStates' | 'globalRagflowConfigs'
>;

export interface AdminRagflowApplication {
  appliedRevision: number;
  botId: string;
  botName: string;
  lastSyncError: string | null;
  lastSyncedAt: string | null;
  syncStatus: string;
}

export interface AdminRagflowPayload {
  applications: AdminRagflowApplication[];
  config: {
    apiBaseUrl: string;
    apiKeyConfigured: boolean;
    datasetIds: string[];
    enabled: boolean;
    knowledgeBaseName: string;
    lastTestError: string | null;
    lastTestStatus: string;
    lastTestedAt: string | null;
    revision: number;
    updatedAt: string;
  };
  summary: {
    botCount: number;
    errorCount: number;
    pendingCount: number;
    syncedCount: number;
  };
}

export async function listAdminRagflow(
  repositories: RagflowAdminRepositories,
): Promise<AdminRagflowPayload> {
  const config = await repositories.globalRagflowConfigs.ensure();
  const [bots, states] = await Promise.all([
    repositories.botInstances.listAllForAdministration(),
    repositories.botRagflowSyncStates.ensureForAllBots(),
  ]);
  const botNames = new Map(bots.map((bot) => [bot.id, bot.name]));
  const applications = states.map((state) => ({
    appliedRevision: state.appliedRevision,
    botId: state.botInstanceId,
    botName: botNames.get(state.botInstanceId) ?? state.botInstanceId,
    lastSyncError: state.lastSyncError,
    lastSyncedAt: toIsoString(state.lastSyncedAt),
    syncStatus: state.syncStatus,
  }));

  return {
    applications,
    config: {
      apiBaseUrl: config.apiBaseUrl,
      apiKeyConfigured: Boolean(config.apiKey),
      datasetIds: config.datasetIds,
      enabled: config.enabled,
      knowledgeBaseName: config.knowledgeBaseName,
      lastTestError: config.lastTestError,
      lastTestStatus: config.lastTestStatus,
      lastTestedAt: toIsoString(config.lastTestedAt),
      revision: config.revision,
      updatedAt: config.updatedAt.toISOString(),
    },
    summary: {
      botCount: applications.length,
      errorCount: applications.filter((item) => item.syncStatus === 'error').length,
      pendingCount: applications.filter((item) => (
        item.syncStatus !== 'error'
        && (item.syncStatus === 'pending' || item.appliedRevision !== config.revision)
      )).length,
      syncedCount: applications.filter((item) => (
        item.syncStatus === 'synced' && item.appliedRevision === config.revision
      )).length,
    },
  };
}

export async function updateAdminRagflow(input: {
  payload: unknown;
  repositories: RagflowAdminRepositories;
  updatedByUserId: string;
}): Promise<AdminRagflowPayload> {
  const parsed = configSchema.safeParse(input.payload);
  if (!parsed.success) throw invalidConfigError();

  await input.repositories.globalRagflowConfigs.ensure();
  try {
    await input.repositories.globalRagflowConfigs.update({
      ...parsed.data,
      updatedByUserId: input.updatedByUserId,
    });
  } catch (error) {
    throw invalidConfigError(error);
  }
  return listAdminRagflow(input.repositories);
}

export async function testAdminRagflowConnection(input: {
  fetchImpl?: typeof fetch;
  payload: unknown;
  repositories: RagflowAdminRepositories;
}): Promise<AdminRagflowPayload> {
  const parsed = testSchema.safeParse(input.payload);
  if (!parsed.success) throw invalidConfigError();

  const current = await input.repositories.globalRagflowConfigs.ensure();
  const requestedApiBaseUrl = parsed.data.apiBaseUrl?.trim();
  const apiBaseUrl = normalizeBaseUrl(requestedApiBaseUrl || current.apiBaseUrl);
  const apiKey = parsed.data.apiKey?.trim() || current.apiKey;
  if (
    requestedApiBaseUrl
    && normalizeBaseUrl(requestedApiBaseUrl) !== normalizeBaseUrl(current.apiBaseUrl)
    && !parsed.data.apiKey?.trim()
  ) {
    throw invalidConfigError(new Error('RAGFlow API key must be provided when testing a different API host.'));
  }
  const datasetIds = normalizeDatasetIds(parsed.data.datasetIds ?? current.datasetIds);
  if (!apiBaseUrl || !apiKey || datasetIds.length === 0) throw invalidConfigError();

  let endpoint: URL;
  try {
    endpoint = createDatasetsEndpoint(apiBaseUrl);
  } catch {
    throw invalidConfigError();
  }
  endpoint.searchParams.set('id', datasetIds[0]);
  endpoint.searchParams.set('page', '1');
  endpoint.searchParams.set('page_size', '1');

  let testError: string | null = null;
  try {
    const response = await (input.fetchImpl ?? fetch)(endpoint.toString(), {
      headers: { authorization: `Bearer ${apiKey}` },
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      testError = `RAGFlow returned HTTP ${response.status}.`;
    } else {
      const body = await response.clone().json().catch(() => null) as unknown;
      if (isRagflowErrorResponse(body)) {
        testError = `RAGFlow returned API code ${body.code}.`;
      } else if (!isValidRagflowDatasetsResponse(body)) {
        testError = 'RAGFlow returned an invalid datasets response.';
      }
    }
  } catch (error) {
    testError = error instanceof Error ? error.message : 'RAGFlow connection failed.';
  }

  await input.repositories.globalRagflowConfigs.recordTestResult({
    error: testError,
    status: testError ? 'error' : 'success',
  });
  const payload = await listAdminRagflow(input.repositories);

  if (testError) {
    throw new ApiError({
      code: 'RAGFLOW_CONNECTION_FAILED',
      message: testError,
      status: 502,
    });
  }
  return payload;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function createDatasetsEndpoint(apiBaseUrl: string): URL {
  const endpoint = new URL(apiBaseUrl);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('Unsupported protocol.');

  const basePath = endpoint.pathname.replace(/\/+$/, '');
  endpoint.pathname = basePath.endsWith('/api/v1')
    ? `${basePath}/datasets`
    : `${basePath}/api/v1/datasets`;
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint;
}

function normalizeDatasetIds(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function isRagflowErrorResponse(value: unknown): value is { code: number } {
  return typeof value === 'object'
    && value !== null
    && 'code' in value
    && typeof value.code === 'number'
    && value.code !== 0;
}

function isValidRagflowDatasetsResponse(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.code === 'number' && record.code !== 0) return false;
  return 'data' in record;
}

function toIsoString(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function invalidConfigError(cause?: unknown): ApiError {
  return new ApiError({
    code: 'RAGFLOW_INVALID_CONFIG',
    message: cause instanceof Error ? cause.message : 'Invalid RAGFlow configuration.',
    status: 400,
  });
}
