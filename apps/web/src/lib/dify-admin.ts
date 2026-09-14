import { z } from 'zod';
import { ApiError } from './api-error';
import type { WebRepositories } from './repositories';

const configSchema = z.object({
  apiBaseUrl: z.string().trim().max(2_000),
  apiKey: z.string().trim().max(2_000).optional(),
  appName: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
}).strict();

const testSchema = z.object({
  apiBaseUrl: z.string().trim().max(2_000).optional(),
  apiKey: z.string().trim().max(2_000).optional(),
}).strict();

type DifyAdminRepositories = Pick<
  WebRepositories,
  'botDifySyncStates' | 'botInstances' | 'globalDifyConfigs'
>;

export interface AdminDifyApplication {
  appliedRevision: number;
  botId: string;
  botName: string;
  lastSyncError: string | null;
  lastSyncedAt: string | null;
  syncStatus: string;
}

export interface AdminDifyPayload {
  applications: AdminDifyApplication[];
  config: {
    apiBaseUrl: string;
    apiKeyConfigured: boolean;
    appName: string;
    enabled: boolean;
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

export async function listAdminDify(
  repositories: DifyAdminRepositories,
): Promise<AdminDifyPayload> {
  const config = await repositories.globalDifyConfigs.ensure();
  const [bots, states] = await Promise.all([
    repositories.botInstances.listAllForAdministration(),
    repositories.botDifySyncStates.ensureForAllBots(),
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
      appName: config.appName,
      enabled: config.enabled,
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
        item.syncStatus === 'pending' || item.appliedRevision !== config.revision
      )).length,
      syncedCount: applications.filter((item) => (
        item.syncStatus === 'synced' && item.appliedRevision === config.revision
      )).length,
    },
  };
}

export async function updateAdminDify(input: {
  payload: unknown;
  repositories: DifyAdminRepositories;
  updatedByUserId: string;
}): Promise<AdminDifyPayload> {
  const parsed = configSchema.safeParse(input.payload);
  if (!parsed.success) throw invalidConfigError();

  await input.repositories.globalDifyConfigs.ensure();
  try {
    await input.repositories.globalDifyConfigs.update({
      ...parsed.data,
      updatedByUserId: input.updatedByUserId,
    });
  } catch (error) {
    throw invalidConfigError(error);
  }
  return listAdminDify(input.repositories);
}

export async function testAdminDifyConnection(input: {
  fetchImpl?: typeof fetch;
  payload: unknown;
  repositories: DifyAdminRepositories;
}): Promise<AdminDifyPayload> {
  const parsed = testSchema.safeParse(input.payload);
  if (!parsed.success) throw invalidConfigError();

  const current = await input.repositories.globalDifyConfigs.ensure();
  const apiBaseUrl = normalizeBaseUrl(parsed.data.apiBaseUrl || current.apiBaseUrl);
  const apiKey = parsed.data.apiKey || current.apiKey;
  if (!apiBaseUrl || !apiKey) throw invalidConfigError();

  let testError: string | null = null;
  try {
    const response = await (input.fetchImpl ?? fetch)(`${apiBaseUrl}/parameters`, {
      headers: { authorization: `Bearer ${apiKey}` },
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      testError = `Dify returned HTTP ${response.status}.`;
    }
  } catch (error) {
    testError = error instanceof Error ? error.message : 'Dify connection failed.';
  }

  await input.repositories.globalDifyConfigs.recordTestResult({
    error: testError,
    status: testError ? 'error' : 'success',
  });
  const payload = await listAdminDify(input.repositories);

  if (testError) {
    throw new ApiError({
      code: 'DIFY_CONNECTION_FAILED',
      message: testError,
      status: 502,
    });
  }
  return payload;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function toIsoString(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function invalidConfigError(cause?: unknown): ApiError {
  return new ApiError({
    code: 'DIFY_INVALID_CONFIG',
    message: cause instanceof Error ? cause.message : 'Invalid Dify configuration.',
    status: 400,
  });
}
