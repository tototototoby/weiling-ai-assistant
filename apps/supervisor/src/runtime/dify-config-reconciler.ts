import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  BotDifySyncRecord,
  BotDifySyncRepository,
  BotInstanceRepository,
  GlobalDifyConfigRecord,
  GlobalDifyConfigRepository,
} from '@weiling-ai/db';
import { resolveBotInstancePaths } from '@weiling-ai/shared';

export const MANAGED_DIFY_MCP_SERVER_NAME = 'weclaws_managed';
export const MANAGED_DIFY_MCP_NODE_PATH = '/usr/local/bin/node';
export const MANAGED_DIFY_MCP_SCRIPT_PATH = '/app/apps/supervisor/dist/dify-mcp-server.js';

const MAX_SETTINGS_BYTES = 2 * 1024 * 1024;
const ACTIVE_RUNTIME_STATUSES = new Set([
  'starting',
  'waiting_for_qr',
  'running',
  'degraded',
]);

type ConfigRepository = Pick<GlobalDifyConfigRepository, 'ensure'>;
type SyncStateRepository = Pick<
  BotDifySyncRepository,
  'ensureForAllBots' | 'markSyncFailed' | 'markSyncSucceeded'
>;
type BotRepository = Pick<BotInstanceRepository, 'findById' | 'requestRestart'>;

export interface DifyConfigReconcilerDependencies {
  botInstances: BotRepository;
  configRepository: ConfigRepository;
  instancesRoot: string;
  logError?: (error: unknown) => void;
  syncStateRepository: SyncStateRepository;
}

export class DifyConfigReconciler {
  private isRunning = false;
  private readonly botInstances: BotRepository;
  private readonly configRepository: ConfigRepository;
  private readonly instancesRoot: string;
  private readonly logError: (error: unknown) => void;
  private readonly syncStateRepository: SyncStateRepository;

  constructor(dependencies: DifyConfigReconcilerDependencies) {
    this.botInstances = dependencies.botInstances;
    this.configRepository = dependencies.configRepository;
    this.instancesRoot = dependencies.instancesRoot;
    this.logError = dependencies.logError ?? console.error;
    this.syncStateRepository = dependencies.syncStateRepository;
  }

  async runOnce(now: Date = new Date()): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const config = await this.configRepository.ensure(now);
      const states = await this.syncStateRepository.ensureForAllBots(now);

      for (const state of states) {
        await this.reconcileBot(state, config, now);
      }
    } finally {
      this.isRunning = false;
    }
  }

  private async reconcileBot(
    state: BotDifySyncRecord,
    config: GlobalDifyConfigRecord,
    now: Date,
  ): Promise<void> {
    try {
      const settingsChanged = await ensureManagedMcpServer(
        this.instancesRoot,
        state.botInstanceId,
      );
      const revisionChanged = state.appliedRevision !== config.revision
        || state.syncStatus !== 'synced'
        || state.lastSyncError !== null;

      if (!settingsChanged && !revisionChanged) return;

      await this.syncStateRepository.markSyncSucceeded(
        state.botInstanceId,
        config.revision,
        now,
      );

      const bot = await this.botInstances.findById(state.botInstanceId);
      if (
        bot
        && bot.desiredState === 'running'
        && ACTIVE_RUNTIME_STATUSES.has(bot.status)
      ) {
        await this.botInstances.requestRestart(bot.id, now);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      try {
        await this.syncStateRepository.markSyncFailed(state.botInstanceId, message, now);
      } catch (markError) {
        this.logError(markError);
      }

      this.logError(new Error(
        `Failed to publish managed Dify MCP config to ${state.botInstanceId}: ${message}`,
      ));
    }
  }
}

export async function ensureManagedMcpServer(
  instancesRoot: string,
  botInstanceId: string,
): Promise<boolean> {
  const { dataDir } = resolveBotInstancePaths(instancesRoot, botInstanceId);
  await mkdir(dataDir, { recursive: true });
  await assertSafeDirectory(dataDir);

  const settingsPath = path.join(dataDir, 'settings.json');
  const settings = await readSettings(settingsPath);
  const managedServer = {
    args: [MANAGED_DIFY_MCP_SCRIPT_PATH],
    command: MANAGED_DIFY_MCP_NODE_PATH,
    type: 'stdio',
  };
  if (settings.mcpServers !== undefined && !isPlainObject(settings.mcpServers)) {
    throw new Error(`FastAgent settings mcpServers must be a JSON object: ${settingsPath}`);
  }
  const currentServers = settings.mcpServers ?? {};

  if (deepEqual(currentServers[MANAGED_DIFY_MCP_SERVER_NAME], managedServer)) {
    return false;
  }

  const nextSettings = {
    ...settings,
    mcpServers: {
      ...currentServers,
      [MANAGED_DIFY_MCP_SERVER_NAME]: managedServer,
    },
  };
  await writeJsonAtomically(settingsPath, nextSettings);
  return true;
}

async function readSettings(settingsPath: string): Promise<Record<string, unknown>> {
  try {
    const stats = await lstat(settingsPath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`FastAgent settings target must be a regular file: ${settingsPath}`);
    }
    if (stats.size > MAX_SETTINGS_BYTES) {
      throw new Error(`FastAgent settings exceed ${MAX_SETTINGS_BYTES} bytes: ${settingsPath}`);
    }

    const parsed = JSON.parse(await readFile(settingsPath, 'utf8')) as unknown;
    if (!isPlainObject(parsed)) {
      throw new Error(`FastAgent settings must contain a JSON object: ${settingsPath}`);
    }
    return parsed;
  } catch (error) {
    if (isMissingFileError(error)) return {};
    if (error instanceof SyntaxError) {
      throw new Error(`FastAgent settings contain invalid JSON: ${settingsPath}`);
    }
    throw error;
  }
}

async function assertSafeDirectory(directoryPath: string): Promise<void> {
  const stats = await lstat(directoryPath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Bot data directory must be a regular directory: ${directoryPath}`);
  }
}

async function writeJsonAtomically(
  filePath: string,
  value: Record<string, unknown>,
): Promise<void> {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(content, 'utf8') > MAX_SETTINGS_BYTES) {
    throw new Error(`FastAgent settings exceed ${MAX_SETTINGS_BYTES} bytes: ${filePath}`);
  }

  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
