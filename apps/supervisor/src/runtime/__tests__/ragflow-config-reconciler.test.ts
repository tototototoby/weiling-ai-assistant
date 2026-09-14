import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BotRagflowSyncRecord, GlobalRagflowConfigRecord } from '@weiling-ai/db';
import { resolveBotInstancePaths } from '@weiling-ai/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MANAGED_DIFY_MCP_SCRIPT_PATH,
  MANAGED_DIFY_MCP_SERVER_NAME,
} from '../dify-config-reconciler';
import { RagflowConfigReconciler } from '../ragflow-config-reconciler';

const tempDirectories: string[] = [];
const now = new Date('2026-07-23T02:00:00.000Z');

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, {
    force: true,
    recursive: true,
  })));
});

describe('RagflowConfigReconciler', () => {
  it('ensures the shared managed MCP server without persisting secrets', async () => {
    const instancesRoot = await createInstancesRoot('bot_1');
    const states = createStates([createState('bot_1')]);
    const bots = createBots('stopped');

    await new RagflowConfigReconciler({
      botInstances: bots,
      configRepository: { ensure: vi.fn().mockResolvedValue(createConfig()) },
      instancesRoot,
      syncStateRepository: states,
    }).runOnce(now);

    const { dataDir } = resolveBotInstancePaths(instancesRoot, 'bot_1');
    const settingsText = await readFile(path.join(dataDir, 'settings.json'), 'utf8');
    expect(JSON.parse(settingsText)).toMatchObject({
      mcpServers: {
        [MANAGED_DIFY_MCP_SERVER_NAME]: { args: [MANAGED_DIFY_MCP_SCRIPT_PATH] },
      },
    });
    expect(settingsText).not.toContain('ragflow-secret');
    expect(states.markSyncSucceeded).toHaveBeenCalledWith('bot_1', 4, now);
    expect(bots.requestRestart).not.toHaveBeenCalled();
  });

  it('requests restart when an active Bot receives a new revision', async () => {
    const instancesRoot = await createInstancesRoot('bot_1');
    const states = createStates([createState('bot_1', { appliedRevision: 3 })]);
    const bots = createBots('running');

    await new RagflowConfigReconciler({
      botInstances: bots,
      configRepository: { ensure: vi.fn().mockResolvedValue(createConfig()) },
      instancesRoot,
      syncStateRepository: states,
    }).runOnce(now);

    expect(bots.requestRestart).toHaveBeenCalledWith('bot_1', now);
  });
});

function createConfig(): GlobalRagflowConfigRecord {
  return {
    apiBaseUrl: 'https://ragflow.example.com',
    apiKey: 'ragflow-secret',
    createdAt: now,
    datasetIds: ['dataset_1'],
    enabled: true,
    id: 'global',
    knowledgeBaseName: 'Company KB',
    lastTestError: null,
    lastTestStatus: 'untested',
    lastTestedAt: null,
    revision: 4,
    updatedAt: now,
    updatedByUserId: 'admin_1',
  };
}

function createState(
  botInstanceId: string,
  overrides: Partial<BotRagflowSyncRecord> = {},
): BotRagflowSyncRecord {
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

function createStates(states: BotRagflowSyncRecord[]) {
  return {
    ensureForAllBots: vi.fn().mockResolvedValue(states),
    markSyncFailed: vi.fn().mockResolvedValue(undefined),
    markSyncSucceeded: vi.fn().mockResolvedValue(undefined),
  };
}

function createBots(status: 'running' | 'stopped') {
  return {
    findById: vi.fn().mockResolvedValue({ desiredState: 'running', id: 'bot_1', status }),
    requestRestart: vi.fn().mockResolvedValue(undefined),
  };
}

async function createInstancesRoot(botInstanceId: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'weiling-ragflow-config-'));
  tempDirectories.push(root);
  await mkdir(resolveBotInstancePaths(root, botInstanceId).dataDir, { recursive: true });
  return root;
}
