import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BotSandboxRuntimePoolRecord } from '@weiling-ai/db';
import {
  normalizeSandboxRuntimeDenyReadPaths,
  SRT_POOL_CONFIG_FILE_VERSION,
} from '@weiling-ai/shared';

export interface SandboxRuntimePoolConfigEntry {
  apiKey: string;
  botInstanceId: string;
  defaultAllowRead: string[];
  defaultAllowWrite: string[];
  defaultDeniedDomains: string[];
  defaultDenyRead: string[];
  defaultDenyWrite: string[];
  enabled: boolean;
  healthCheckIntervalMs: number;
  maxConcurrentInit: number;
  minReadyProcesses: number;
  poolSize: number;
  port: number;
  portRangeEnd: number;
  portRangeStart: number;
  restartRequestedAt: string | null;
  sessionTimeoutMs: number;
  updatedAt: string;
  url: string;
  workspaceBasePath: string;
  workspaceMapFile: string;
}

export interface SandboxRuntimePoolConfigDocument {
  pools: SandboxRuntimePoolConfigEntry[];
  updatedAt: string;
  version: number;
}

export interface CreateSandboxRuntimePoolConfigDocumentInput {
  now?: Date;
  pools: BotSandboxRuntimePoolRecord[];
  serviceHost: string;
  workspaceMapDir: string;
}

export interface WriteSandboxRuntimePoolConfigFileInput extends CreateSandboxRuntimePoolConfigDocumentInput {
  filePath: string;
}

export function createSandboxRuntimePoolConfigDocument(
  input: CreateSandboxRuntimePoolConfigDocumentInput,
): SandboxRuntimePoolConfigDocument {
  return {
    pools: [...input.pools]
      .sort((first, second) => first.botInstanceId.localeCompare(second.botInstanceId))
      .map((pool) => ({
        apiKey: pool.apiKey,
        botInstanceId: pool.botInstanceId,
        defaultAllowRead: pool.defaultAllowRead,
        defaultAllowWrite: pool.defaultAllowWrite,
        defaultDeniedDomains: pool.defaultDeniedDomains,
        defaultDenyRead: normalizeSandboxRuntimeDenyReadPaths(pool.defaultDenyRead),
        defaultDenyWrite: pool.defaultDenyWrite,
        enabled: pool.enabled,
        healthCheckIntervalMs: pool.healthCheckIntervalMs,
        maxConcurrentInit: pool.maxConcurrentInit,
        minReadyProcesses: pool.minReadyProcesses,
        poolSize: pool.poolSize,
        port: pool.port,
        portRangeEnd: pool.portRangeEnd,
        portRangeStart: pool.portRangeStart,
        restartRequestedAt: pool.restartRequestedAt?.toISOString() ?? null,
        sessionTimeoutMs: pool.sessionTimeoutMs,
        updatedAt: pool.updatedAt.toISOString(),
        url: `http://${input.serviceHost}:${pool.port}`,
        workspaceBasePath: pool.workspaceBasePath,
        workspaceMapFile: join(input.workspaceMapDir, `${pool.botInstanceId}.json`),
      })),
    updatedAt: (input.now ?? new Date()).toISOString(),
    version: SRT_POOL_CONFIG_FILE_VERSION,
  };
}

export async function writeSandboxRuntimePoolConfigFile(
  input: WriteSandboxRuntimePoolConfigFileInput,
): Promise<SandboxRuntimePoolConfigDocument> {
  const document = createSandboxRuntimePoolConfigDocument(input);
  await mkdir(dirname(input.filePath), { recursive: true });

  const tempFile = `${input.filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  await rename(tempFile, input.filePath);

  return document;
}
