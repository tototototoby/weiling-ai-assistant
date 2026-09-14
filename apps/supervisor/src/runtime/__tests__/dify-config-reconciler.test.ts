import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BotDifySyncRecord, GlobalDifyConfigRecord } from '@weiling-ai/db';
import { resolveBotInstancePaths } from '@weiling-ai/shared';
import type { BotDesiredState, BotStatus } from '@weiling-ai/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DifyConfigReconciler,
  MANAGED_DIFY_MCP_NODE_PATH,
  MANAGED_DIFY_MCP_SCRIPT_PATH,
  MANAGED_DIFY_MCP_SERVER_NAME,
} from '../dify-config-reconciler';

const tempDirectories: string[] = [];
const now = new Date('2026-07-23T02:00:00.000Z');

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, {
    force: true,
    recursive: true,
  })));
});

describe('DifyConfigReconciler', () => {
  it('preserves existing settings and publishes the managed server without secrets', async () => {
    const instancesRoot = await createInstancesRoot('bot_1');
    const { dataDir } = resolveBotInstancePaths(instancesRoot, 'bot_1');
    await writeFile(path.join(dataDir, 'settings.json'), JSON.stringify({
      dream: { autoDreamEnabled: false },
      mcpServers: {
        employee_owned: { command: 'custom-mcp', args: ['serve'] },
      },
    }));
    const syncStates = createSyncStates([createSyncState('bot_1')]);
    const botInstances = createBots({
      bot_1: { desiredState: 'running', id: 'bot_1', status: 'stopped' },
    });

    await new DifyConfigReconciler({
      botInstances,
      configRepository: createConfigRepository(),
      instancesRoot,
      syncStateRepository: syncStates,
    }).runOnce(now);

    const settingsText = await readFile(path.join(dataDir, 'settings.json'), 'utf8');
    const settings = JSON.parse(settingsText) as Record<string, unknown>;
    expect(settings).toMatchObject({
      dream: { autoDreamEnabled: false },
      mcpServers: {
        employee_owned: { command: 'custom-mcp', args: ['serve'] },
        [MANAGED_DIFY_MCP_SERVER_NAME]: {
          args: [MANAGED_DIFY_MCP_SCRIPT_PATH],
          command: MANAGED_DIFY_MCP_NODE_PATH,
          type: 'stdio',
        },
      },
    });
    expect(settingsText).not.toContain('app-secret');
    expect(syncStates.markSyncSucceeded).toHaveBeenCalledWith('bot_1', 3, now);
    expect(botInstances.requestRestart).not.toHaveBeenCalled();
  });

  it('requests a durable restart for active bots when a new revision is applied', async () => {
    const instancesRoot = await createInstancesRoot('bot_1');
    const syncStates = createSyncStates([createSyncState('bot_1', { appliedRevision: 2 })]);
    const botInstances = createBots({
      bot_1: { desiredState: 'running', id: 'bot_1', status: 'running' },
    });

    await new DifyConfigReconciler({
      botInstances,
      configRepository: createConfigRepository(),
      instancesRoot,
      syncStateRepository: syncStates,
    }).runOnce(now);

    expect(botInstances.requestRestart).toHaveBeenCalledWith('bot_1', now);
  });

  it('leaves a valid current projection untouched', async () => {
    const instancesRoot = await createInstancesRoot('bot_1');
    const { dataDir } = resolveBotInstancePaths(instancesRoot, 'bot_1');
    await writeFile(path.join(dataDir, 'settings.json'), `${JSON.stringify({
      mcpServers: {
        [MANAGED_DIFY_MCP_SERVER_NAME]: {
          args: [MANAGED_DIFY_MCP_SCRIPT_PATH],
          command: MANAGED_DIFY_MCP_NODE_PATH,
          type: 'stdio',
        },
      },
    }, null, 2)}\n`);
    const syncStates = createSyncStates([createSyncState('bot_1', {
      appliedRevision: 3,
      syncStatus: 'synced',
    })]);
    const botInstances = createBots({
      bot_1: { desiredState: 'running', id: 'bot_1', status: 'running' },
    });

    await new DifyConfigReconciler({
      botInstances,
      configRepository: createConfigRepository(),
      instancesRoot,
      syncStateRepository: syncStates,
    }).runOnce(now);

    expect(syncStates.markSyncSucceeded).not.toHaveBeenCalled();
    expect(botInstances.requestRestart).not.toHaveBeenCalled();
  });

  it('reports invalid settings without replacing employee data', async () => {
    const instancesRoot = await createInstancesRoot('bot_1');
    const { dataDir } = resolveBotInstancePaths(instancesRoot, 'bot_1');
    const settingsPath = path.join(dataDir, 'settings.json');
    await writeFile(settingsPath, '{ invalid');
    const syncStates = createSyncStates([createSyncState('bot_1')]);
    const logError = vi.fn();

    await new DifyConfigReconciler({
      botInstances: createBots({}),
      configRepository: createConfigRepository(),
      instancesRoot,
      logError,
      syncStateRepository: syncStates,
    }).runOnce(now);

    expect(await readFile(settingsPath, 'utf8')).toBe('{ invalid');
    expect(syncStates.markSyncFailed).toHaveBeenCalledWith(
      'bot_1',
      expect.stringContaining('invalid JSON'),
      now,
    );
    expect(logError).toHaveBeenCalled();
  });
});

function createConfigRepository() {
  return { ensure: vi.fn().mockResolvedValue(createConfig()) };
}

function createConfig(): GlobalDifyConfigRecord {
  return {
    apiBaseUrl: 'https://dify.example.com/v1',
    apiKey: 'app-secret',
    appName: 'Company KB',
    createdAt: now,
    enabled: true,
    id: 'global',
    lastTestError: null,
    lastTestStatus: 'untested',
    lastTestedAt: null,
    revision: 3,
    updatedAt: now,
    updatedByUserId: 'admin_1',
  };
}

function createSyncState(
  botInstanceId: string,
  overrides: Partial<BotDifySyncRecord> = {},
): BotDifySyncRecord {
  return {
    appliedRevision: 0,
    botInstanceId,
    createdAt: now,
    lastSyncError: null,
    lastSyncedAt: null,
    syncStatus: 'pending',
    updatedAt: now,
    ...overrides,
  };
}

function createSyncStates(states: BotDifySyncRecord[]) {
  return {
    ensureForAllBots: vi.fn().mockResolvedValue(states),
    markSyncFailed: vi.fn().mockResolvedValue(undefined),
    markSyncSucceeded: vi.fn().mockResolvedValue(undefined),
  };
}

function createBots(bots: Record<string, {
  desiredState: BotDesiredState;
  id: string;
  status: BotStatus;
}>) {
  return {
    findById: vi.fn().mockImplementation(async (id: string) => bots[id] ?? null),
    requestRestart: vi.fn().mockResolvedValue(undefined),
  };
}

async function createInstancesRoot(botInstanceId: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'weiling-dify-config-'));
  tempDirectories.push(root);
  const { dataDir } = resolveBotInstancePaths(root, botInstanceId);
  await mkdir(dataDir, { recursive: true });
  return root;
}
