import { readFile } from 'node:fs/promises';
import type {
  BotSandboxRuntimePoolRecord,
  UpdateBotSandboxRuntimePoolInput,
} from '@weiling-ai/db';
import { normalizeSandboxRuntimeDenyReadPaths } from '@weiling-ai/shared';
import { z } from 'zod';
import { ApiError } from './api-error';
import type { WebRepositories } from './repositories';

type SandboxRuntimeAdminRepositories = {
  botInstances: Pick<WebRepositories['botInstances'], 'findById'>;
  botSandboxRuntimePools: Pick<
    WebRepositories['botSandboxRuntimePools'],
    'listAll' | 'requestRestart' | 'updateByBotInstanceId'
  >;
  users: Pick<WebRepositories['users'], 'findById'>;
};

const positiveIntegerSchema = z.number().int().positive();
const stringListSchema = z.array(z.string());

const sandboxRuntimePoolPatchSchema = z.object({
  defaultAllowRead: stringListSchema.optional(),
  defaultAllowWrite: stringListSchema.optional(),
  defaultDeniedDomains: stringListSchema.optional(),
  defaultDenyRead: stringListSchema.optional(),
  defaultDenyWrite: stringListSchema.optional(),
  enabled: z.boolean().optional(),
  healthCheckIntervalMs: positiveIntegerSchema.optional(),
  maxConcurrentInit: positiveIntegerSchema.optional(),
  minReadyProcesses: positiveIntegerSchema.optional(),
  poolSize: positiveIntegerSchema.optional(),
  sessionTimeoutMs: positiveIntegerSchema.optional(),
}).strict().superRefine((payload, context) => {
  if (
    payload.minReadyProcesses !== undefined
    && payload.poolSize !== undefined
    && payload.minReadyProcesses > payload.poolSize
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'minReadyProcesses must be less than or equal to poolSize.',
      path: ['minReadyProcesses'],
    });
  }

});

const runtimeManagerStatusSchema = z.object({
  cpuPercent: z.number().nullable().optional(),
  degradedPoolCount: z.number().nullable().optional(),
  failedPoolCount: z.number().nullable().optional(),
  lastErrorMessage: z.string().nullable().optional(),
  managedPoolCount: z.number().optional(),
  pid: z.number().nullable().optional(),
  rssBytes: z.number().nullable().optional(),
  runningPoolCount: z.number().optional(),
  state: z.string().optional(),
  totalActiveSessions: z.number().nullable().optional(),
  totalPoolSize: z.number().optional(),
  uptimeMs: z.number().nullable().optional(),
}).passthrough();

const runtimePoolStatusSchema = z.object({
  activeSessions: z.number().nullable().optional(),
  botInstanceId: z.string(),
  busyProcesses: z.number().nullable().optional(),
  cpuPercent: z.number().nullable().optional(),
  lastErrorMessage: z.string().nullable().optional(),
  lastExitCode: z.number().nullable().optional(),
  lastHealthAt: z.string().nullable().optional(),
  lastRestartAt: z.string().nullable().optional(),
  pid: z.number().nullable().optional(),
  readyProcesses: z.number().nullable().optional(),
  rssBytes: z.number().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  state: z.string().optional(),
}).passthrough();

const runtimeStatusDocumentSchema = z.object({
  manager: runtimeManagerStatusSchema.optional(),
  pools: z.array(runtimePoolStatusSchema).default([]),
  updatedAt: z.string().optional(),
  version: z.number().optional(),
}).passthrough();

export interface AdminSandboxRuntimePoolRuntime {
  activeSessions: number | null;
  busyProcesses: number | null;
  cpuPercent: number | null;
  lastErrorMessage: string | null;
  lastExitCode: number | null;
  lastHealthAt: string | null;
  lastRestartAt: string | null;
  pid: number | null;
  readyProcesses: number | null;
  rssBytes: number | null;
  startedAt: string | null;
  state: string;
}

export interface AdminSandboxRuntimeManagerStatus {
  cpuPercent: number | null;
  degradedPoolCount: number | null;
  failedPoolCount: number | null;
  lastErrorMessage: string | null;
  managedPoolCount: number | null;
  pid: number | null;
  rssBytes: number | null;
  runningPoolCount: number | null;
  state: string;
  totalActiveSessions: number | null;
  totalPoolSize: number | null;
  uptimeMs: number | null;
}

export interface AdminSandboxRuntimePoolItem {
  botInstanceId: string;
  botName: string | null;
  createdAt: string;
  defaultAllowRead: string[];
  defaultAllowWrite: string[];
  defaultDeniedDomains: string[];
  defaultDenyRead: string[];
  defaultDenyWrite: string[];
  enabled: boolean;
  healthCheckIntervalMs: number;
  id: string;
  maxConcurrentInit: number;
  minReadyProcesses: number;
  ownerEmail: string | null;
  ownerUserId: string;
  poolSize: number;
  restartRequestedAt: string | null;
  runtime: AdminSandboxRuntimePoolRuntime | null;
  sessionTimeoutMs: number;
  updatedAt: string;
}

export interface AdminSandboxRuntimePoolsPayload {
  manager: AdminSandboxRuntimeManagerStatus | null;
  pools: AdminSandboxRuntimePoolItem[];
  statusUpdatedAt: string | null;
}

export interface ListAdminSandboxRuntimePoolsInput {
  repositories: SandboxRuntimeAdminRepositories;
  statusFilePath: string;
}

export interface UpdateAdminSandboxRuntimePoolInput {
  botInstanceId: string;
  payload: unknown;
  repositories: SandboxRuntimeAdminRepositories;
}

export interface RequestAdminSandboxRuntimePoolRestartInput {
  botInstanceId: string;
  repositories: SandboxRuntimeAdminRepositories;
}

export async function listAdminSandboxRuntimePools(
  input: ListAdminSandboxRuntimePoolsInput,
): Promise<AdminSandboxRuntimePoolsPayload> {
  const [pools, statusDocument] = await Promise.all([
    input.repositories.botSandboxRuntimePools.listAll(),
    readRuntimeStatusDocument(input.statusFilePath),
  ]);
  const runtimeByBotInstanceId = new Map(
    (statusDocument?.pools ?? []).map((poolStatus) => [poolStatus.botInstanceId, toRuntimeStatus(poolStatus)]),
  );
  const metadataByBotInstanceId = await fetchPoolMetadata(input.repositories, pools);

  return {
    manager: statusDocument?.manager ? toManagerStatus(statusDocument.manager) : null,
    pools: pools.map((pool) => {
      const metadata = metadataByBotInstanceId.get(pool.botInstanceId);
      return toAdminSandboxRuntimePoolItem(
        pool,
        metadata?.botName ?? null,
        metadata?.ownerUserId ?? 'unknown',
        metadata?.ownerEmail ?? null,
        runtimeByBotInstanceId.get(pool.botInstanceId) ?? null,
      );
    }),
    statusUpdatedAt: statusDocument?.updatedAt ?? null,
  };
}

export async function updateAdminSandboxRuntimePool(
  input: UpdateAdminSandboxRuntimePoolInput,
): Promise<AdminSandboxRuntimePoolItem> {
  const parsed = sandboxRuntimePoolPatchSchema.safeParse(input.payload);

  if (!parsed.success) {
    throw invalidConfigError();
  }

  try {
    const nextPayload = parsed.data.defaultDenyRead
      ? {
        ...parsed.data,
        defaultDenyRead: normalizeSandboxRuntimeDenyReadPaths(parsed.data.defaultDenyRead),
      }
      : parsed.data;
    const updated = await input.repositories.botSandboxRuntimePools.updateByBotInstanceId(
      input.botInstanceId,
      nextPayload satisfies UpdateBotSandboxRuntimePoolInput,
    );

    if (!updated) {
      throw notFoundError();
    }

    const bot = await input.repositories.botInstances.findById(updated.botInstanceId);
    const owner = bot ? await input.repositories.users.findById(bot.ownerUserId) : null;
    return toAdminSandboxRuntimePoolItem(
      updated,
      bot?.name ?? null,
      bot?.ownerUserId ?? 'unknown',
      owner?.email ?? null,
      null,
    );
  } catch (error) {
    throw mapSandboxRuntimePoolRepositoryError(error);
  }
}

export async function requestAdminSandboxRuntimePoolRestart(
  input: RequestAdminSandboxRuntimePoolRestartInput,
): Promise<{ botInstanceId: string; restartRequestedAt: string | null }> {
  const restartedAt = new Date();
  const pool = await input.repositories.botSandboxRuntimePools.requestRestart(input.botInstanceId, restartedAt);

  if (!pool) {
    throw notFoundError();
  }

  return {
    botInstanceId: pool.botInstanceId,
    restartRequestedAt: pool.restartRequestedAt?.toISOString() ?? null,
  };
}

async function readRuntimeStatusDocument(statusFilePath: string) {
  let raw: string;

  try {
    raw = await readFile(statusFilePath, 'utf8');
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) {
      return null;
    }

    throw error;
  }

  return runtimeStatusDocumentSchema.parse(JSON.parse(raw));
}

async function fetchPoolMetadata(
  repositories: SandboxRuntimeAdminRepositories,
  pools: readonly BotSandboxRuntimePoolRecord[],
): Promise<Map<string, {
  botName: string | null;
  ownerEmail: string | null;
  ownerUserId: string | null;
}>> {
  const bots = await Promise.all(pools.map((pool) => repositories.botInstances.findById(pool.botInstanceId)));
  const ownerIds = Array.from(new Set(bots.flatMap((bot) => bot ? [bot.ownerUserId] : [])));
  const users = await Promise.all(ownerIds.map((ownerId) => repositories.users.findById(ownerId)));
  const emailByUserId = new Map<string, string>();

  users.forEach((user, index) => {
    if (!user) {
      return;
    }

    emailByUserId.set(ownerIds[index], user.email);
  });

  return new Map(pools.map((pool, index) => [
    pool.botInstanceId,
    {
      botName: bots[index]?.name ?? null,
      ownerEmail: bots[index] ? emailByUserId.get(bots[index]!.ownerUserId) ?? null : null,
      ownerUserId: bots[index]?.ownerUserId ?? null,
    },
  ]));
}

function toAdminSandboxRuntimePoolItem(
  pool: BotSandboxRuntimePoolRecord,
  botName: string | null,
  ownerUserId: string,
  ownerEmail: string | null,
  runtime: AdminSandboxRuntimePoolRuntime | null,
): AdminSandboxRuntimePoolItem {
  return {
    botInstanceId: pool.botInstanceId,
    botName,
    createdAt: pool.createdAt.toISOString(),
    defaultAllowRead: pool.defaultAllowRead,
    defaultAllowWrite: pool.defaultAllowWrite,
    defaultDeniedDomains: pool.defaultDeniedDomains,
    defaultDenyRead: normalizeSandboxRuntimeDenyReadPaths(pool.defaultDenyRead),
    defaultDenyWrite: pool.defaultDenyWrite,
    enabled: pool.enabled,
    healthCheckIntervalMs: pool.healthCheckIntervalMs,
    id: pool.id,
    maxConcurrentInit: pool.maxConcurrentInit,
    minReadyProcesses: pool.minReadyProcesses,
    ownerEmail,
    ownerUserId,
    poolSize: pool.poolSize,
    restartRequestedAt: pool.restartRequestedAt?.toISOString() ?? null,
    runtime,
    sessionTimeoutMs: pool.sessionTimeoutMs,
    updatedAt: pool.updatedAt.toISOString(),
  };
}

function toRuntimeStatus(status: z.infer<typeof runtimePoolStatusSchema>): AdminSandboxRuntimePoolRuntime {
  return {
    activeSessions: status.activeSessions ?? null,
    busyProcesses: status.busyProcesses ?? null,
    cpuPercent: status.cpuPercent ?? null,
    lastErrorMessage: status.lastErrorMessage ?? null,
    lastExitCode: status.lastExitCode ?? null,
    lastHealthAt: status.lastHealthAt ?? null,
    lastRestartAt: status.lastRestartAt ?? null,
    pid: status.pid ?? null,
    readyProcesses: status.readyProcesses ?? null,
    rssBytes: status.rssBytes ?? null,
    startedAt: status.startedAt ?? null,
    state: status.state ?? 'unknown',
  };
}

function toManagerStatus(status: z.infer<typeof runtimeManagerStatusSchema>): AdminSandboxRuntimeManagerStatus {
  return {
    cpuPercent: status.cpuPercent ?? null,
    degradedPoolCount: status.degradedPoolCount ?? null,
    failedPoolCount: status.failedPoolCount ?? null,
    lastErrorMessage: status.lastErrorMessage ?? null,
    managedPoolCount: status.managedPoolCount ?? null,
    pid: status.pid ?? null,
    rssBytes: status.rssBytes ?? null,
    runningPoolCount: status.runningPoolCount ?? null,
    state: status.state ?? 'unknown',
    totalActiveSessions: status.totalActiveSessions ?? null,
    totalPoolSize: status.totalPoolSize ?? null,
    uptimeMs: status.uptimeMs ?? null,
  };
}

function mapSandboxRuntimePoolRepositoryError(error: unknown): unknown {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof Error && error.message.includes('overlaps another pool')) {
    return new ApiError({
      code: 'SRT_POOL_PORT_RANGE_CONFLICT',
      message: 'Sandbox runtime pool port range overlaps another pool.',
      status: 409,
    });
  }

  if (error instanceof Error && error.message.includes('port is already used by another pool')) {
    return new ApiError({
      code: 'SRT_POOL_PORT_CONFLICT',
      message: 'Sandbox runtime pool port is already used by another pool.',
      status: 409,
    });
  }

  if (error instanceof Error && error.message.startsWith('Bot SRT pool ')) {
    return invalidConfigError();
  }

  return error;
}

function invalidConfigError(): ApiError {
  return new ApiError({
    code: 'SRT_POOL_INVALID_CONFIG',
    message: 'Invalid sandbox runtime pool config.',
    status: 400,
  });
}

function notFoundError(): ApiError {
  return new ApiError({
    code: 'SRT_POOL_NOT_FOUND',
    message: 'Sandbox runtime pool not found.',
    status: 404,
  });
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code: unknown }).code === code;
}
