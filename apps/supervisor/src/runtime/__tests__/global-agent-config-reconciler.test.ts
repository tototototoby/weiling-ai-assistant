import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  BotAgentConfigSyncRecord,
  GlobalAgentConfigSnapshot,
} from '@weiling-ai/db';
import { resolveBotInstancePaths } from '@weiling-ai/shared';
import {
  resolveManagedSkillsPaths,
  type ManagedSkillsOperationResult,
} from '@weiling-ai/shared/managed-skills';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlobalAgentConfigReconciler } from '../global-agent-config-reconciler';

const tempDirectories: string[] = [];
const now = new Date('2026-07-21T02:00:00.000Z');

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, {
    force: true,
    recursive: true,
  })));
});

describe('GlobalAgentConfigReconciler', () => {
  it('seeds the global config and applies documents plus enabled skills to every new bot', async () => {
    const harness = await createHarness(['bot_1', 'bot_2']);
    const snapshot = createSnapshot();
    const configRepository = {
      ensure: vi.fn().mockResolvedValue(snapshot),
      getSnapshot: vi.fn().mockResolvedValue(null),
    };
    const syncStateRepository = createSyncStateRepository([
      createSyncState('bot_1'),
      createSyncState('bot_2'),
    ]);
    const syncSkills = vi.fn().mockResolvedValue(successfulSkillResult());

    await new GlobalAgentConfigReconciler({
      configRepository,
      instancesRoot: harness.instancesRoot,
      overrideRepository: createOverrideRepository(),
      syncManagedSkills: syncSkills,
      syncStateRepository,
      workspaceRoot: harness.workspaceRoot,
    }).runOnce(now);

    expect(configRepository.ensure).toHaveBeenCalledWith({
      agentsMarkdown: '# Seed AGENTS\n',
      createdAt: now,
      skills: [
        { enabled: true, skillName: 'html-report' },
        { enabled: true, skillName: 'weather' },
      ],
      soulMarkdown: '# Seed SOUL\n',
    });
    await expect(readBotDocument(
      harness.instancesRoot,
      'bot_1',
      'AGENTS.md',
    )).resolves.toBe('# Global AGENTS\n');
    await expect(readBotDocument(
      harness.instancesRoot,
      'bot_2',
      'SOUL.md',
    )).resolves.toBe('# Global SOUL\n');
    expect(syncSkills).toHaveBeenCalledTimes(2);
    expect(syncSkills).toHaveBeenCalledWith(expect.objectContaining({
      enabledSkillNames: ['html-report'],
    }));
    expect(syncStateRepository.markSyncSucceeded).toHaveBeenCalledTimes(2);
    expect(syncStateRepository.markSyncFailed).not.toHaveBeenCalled();
  });

  it('does not touch a bot whose current revision is already synced', async () => {
    const harness = await createHarness(['bot_1']);
    await writeCurrentProjection(harness.instancesRoot, 'bot_1');
    const configRepository = {
      ensure: vi.fn(),
      getSnapshot: vi.fn().mockResolvedValue(createSnapshot()),
    };
    const syncStateRepository = createSyncStateRepository([
      createSyncState('bot_1', {
        appliedRevision: 7,
        syncStatus: 'synced',
      }),
    ]);
    const syncSkills = vi.fn();

    await new GlobalAgentConfigReconciler({
      configRepository,
      instancesRoot: harness.instancesRoot,
      overrideRepository: createOverrideRepository(),
      syncManagedSkills: syncSkills,
      syncStateRepository,
      workspaceRoot: harness.workspaceRoot,
    }).runOnce(now);

    expect(configRepository.ensure).not.toHaveBeenCalled();
    expect(syncSkills).not.toHaveBeenCalled();
    expect(syncStateRepository.markSyncSucceeded).not.toHaveBeenCalled();
  });

  it('appends an administrator override only to its target Bot', async () => {
    const harness = await createHarness(['bot_1', 'bot_2']);
    const configRepository = {
      ensure: vi.fn(),
      getSnapshot: vi.fn().mockResolvedValue(createSnapshot()),
    };
    const syncStateRepository = createSyncStateRepository([
      createSyncState('bot_1'),
      createSyncState('bot_2'),
    ]);
    const syncSkills = vi.fn().mockResolvedValue(successfulSkillResult());

    await new GlobalAgentConfigReconciler({
      configRepository,
      instancesRoot: harness.instancesRoot,
      overrideRepository: createOverrideRepository({
        bot_1: {
          agentsAppendix: 'Always answer this employee in concise Chinese.',
          revision: 3,
          soulAppendix: 'Address the employee as Xue.',
        },
      }),
      syncManagedSkills: syncSkills,
      syncStateRepository,
      workspaceRoot: harness.workspaceRoot,
    }).runOnce(now);

    await expect(readBotDocument(harness.instancesRoot, 'bot_1', 'AGENTS.md'))
      .resolves.toContain('Always answer this employee in concise Chinese.');
    await expect(readBotDocument(harness.instancesRoot, 'bot_1', 'SOUL.md'))
      .resolves.toContain('Address the employee as Xue.');
    await expect(readBotDocument(harness.instancesRoot, 'bot_2', 'AGENTS.md'))
      .resolves.toBe('# Global AGENTS\n');
    expect(syncStateRepository.markSyncSucceeded).toHaveBeenCalledWith('bot_1', {
      appliedOverrideRevision: 3,
      appliedRevision: 7,
      lastSyncedAt: now,
    });
  });

  it('repairs filesystem drift even when the database revision is already synced', async () => {
    const harness = await createHarness(['bot_1']);
    await writeCurrentProjection(harness.instancesRoot, 'bot_1', ['html-report', 'weather']);
    const configRepository = {
      ensure: vi.fn(),
      getSnapshot: vi.fn().mockResolvedValue(createSnapshot()),
    };
    const syncStateRepository = createSyncStateRepository([
      createSyncState('bot_1', {
        appliedRevision: 7,
        syncStatus: 'synced',
      }),
    ]);
    const syncSkills = vi.fn().mockResolvedValue(successfulSkillResult());

    await new GlobalAgentConfigReconciler({
      configRepository,
      instancesRoot: harness.instancesRoot,
      overrideRepository: createOverrideRepository(),
      syncManagedSkills: syncSkills,
      syncStateRepository,
      workspaceRoot: harness.workspaceRoot,
    }).runOnce(now);

    expect(syncSkills).toHaveBeenCalledWith(expect.objectContaining({
      enabledSkillNames: ['html-report'],
    }));
    expect(syncStateRepository.markSyncSucceeded).toHaveBeenCalledWith('bot_1', {
      appliedOverrideRevision: 0,
      appliedRevision: 7,
      lastSyncedAt: now,
    });
  });

  it('records one unsafe workspace target and continues applying the other bots', async () => {
    const harness = await createHarness(['bot_bad', 'bot_good']);
    const badWorkspace = resolveBotInstancePaths(harness.instancesRoot, 'bot_bad').workspaceDir;
    await mkdir(path.join(badWorkspace, 'AGENTS.md'), { recursive: true });
    const configRepository = {
      ensure: vi.fn(),
      getSnapshot: vi.fn().mockResolvedValue(createSnapshot()),
    };
    const syncStateRepository = createSyncStateRepository([
      createSyncState('bot_bad'),
      createSyncState('bot_good'),
    ]);
    const syncSkills = vi.fn().mockResolvedValue(successfulSkillResult());
    const logError = vi.fn<(error: unknown) => void>();

    await new GlobalAgentConfigReconciler({
      configRepository,
      instancesRoot: harness.instancesRoot,
      logError,
      overrideRepository: createOverrideRepository(),
      syncManagedSkills: syncSkills,
      syncStateRepository,
      workspaceRoot: harness.workspaceRoot,
    }).runOnce(now);

    expect(syncStateRepository.markSyncFailed).toHaveBeenCalledWith('bot_bad', {
      error: expect.stringContaining('regular file'),
      lastSyncedAt: now,
    });
    expect(syncStateRepository.markSyncSucceeded).toHaveBeenCalledWith('bot_good', {
      appliedOverrideRevision: 0,
      appliedRevision: 7,
      lastSyncedAt: now,
    });
    await expect(readBotDocument(
      harness.instancesRoot,
      'bot_good',
      'AGENTS.md',
    )).resolves.toBe('# Global AGENTS\n');
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('does not mark a revision applied when managed skill filtering fails', async () => {
    const harness = await createHarness(['bot_1']);
    const configRepository = {
      ensure: vi.fn(),
      getSnapshot: vi.fn().mockResolvedValue(createSnapshot()),
    };
    const syncStateRepository = createSyncStateRepository([createSyncState('bot_1')]);
    const syncSkills = vi.fn().mockResolvedValue({
      ...successfulSkillResult(),
      error: { code: 'SKILL_NOT_IN_MANIFEST', message: 'unknown skill' },
      errors: [{ code: 'SKILL_NOT_IN_MANIFEST', message: 'unknown skill' }],
      status: 'error',
    });

    await new GlobalAgentConfigReconciler({
      configRepository,
      instancesRoot: harness.instancesRoot,
      logError: vi.fn(),
      overrideRepository: createOverrideRepository(),
      syncManagedSkills: syncSkills,
      syncStateRepository,
      workspaceRoot: harness.workspaceRoot,
    }).runOnce(now);

    expect(syncStateRepository.markSyncSucceeded).not.toHaveBeenCalled();
    expect(syncStateRepository.markSyncFailed).toHaveBeenCalledWith('bot_1', {
      error: 'SKILL_NOT_IN_MANIFEST: unknown skill',
      lastSyncedAt: now,
    });
  });
});

function createSnapshot(): GlobalAgentConfigSnapshot {
  return {
    config: {
      agentsMarkdown: '# Global AGENTS\n',
      createdAt: now,
      id: 'global',
      revision: 7,
      soulMarkdown: '# Global SOUL\n',
      updatedAt: now,
    },
    skills: [
      {
        createdAt: now,
        enabled: true,
        skillName: 'html-report',
        updatedAt: now,
      },
      {
        createdAt: now,
        enabled: false,
        skillName: 'weather',
        updatedAt: now,
      },
    ],
  };
}

function createSyncState(
  botInstanceId: string,
  overrides: Partial<BotAgentConfigSyncRecord> = {},
): BotAgentConfigSyncRecord {
  return {
    appliedOverrideRevision: 0,
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

function createOverrideRepository(overrides: Record<string, {
  agentsAppendix: string;
  revision: number;
  soulAppendix: string;
}> = {}) {
  return {
    findByBotId: vi.fn().mockImplementation(async (botInstanceId: string) => {
      const override = overrides[botInstanceId];
      if (!override) return null;
      return {
        ...override,
        botInstanceId,
        changeReason: 'Support adjustment',
        createdAt: now,
        updatedAt: now,
        updatedByEmail: 'admin@example.com',
      };
    }),
  };
}

function createSyncStateRepository(states: BotAgentConfigSyncRecord[]) {
  return {
    ensureForAllBots: vi.fn().mockResolvedValue(states),
    markSyncFailed: vi.fn().mockResolvedValue(undefined),
    markSyncSucceeded: vi.fn().mockResolvedValue(undefined),
  };
}

function successfulSkillResult(): ManagedSkillsOperationResult {
  return {
    bundleVersion: 'bundle-v1',
    error: null,
    errors: [],
    installedSkills: [],
    metadataRepaired: false,
    operation: 'sync-all-managed',
    removedSkills: [],
    repairedMarkers: [],
    skippedConflicts: [],
    status: 'success',
    updatedSkills: [],
  };
}

async function createHarness(botInstanceIds: string[]) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'weiling-global-agent-'));
  tempDirectories.push(workspaceRoot);
  const instancesRoot = path.join(workspaceRoot, 'instances');
  const seedRoot = path.join(workspaceRoot, 'resources', 'agent', 'global');
  const bundleRoot = path.join(workspaceRoot, 'resources', 'skills', 'managed');
  await mkdir(seedRoot, { recursive: true });
  await mkdir(bundleRoot, { recursive: true });
  await writeFile(path.join(seedRoot, 'AGENTS.md'), '# Seed AGENTS\n');
  await writeFile(path.join(seedRoot, 'SOUL.md'), '# Seed SOUL\n');
  await Promise.all(['html-report', 'weather'].map(async (skillName) => {
    const skillRoot = path.join(bundleRoot, skillName);
    await mkdir(skillRoot, { recursive: true });
    await writeFile(path.join(skillRoot, 'SKILL.md'), `# ${skillName}\n`);
  }));
  await writeFile(path.join(bundleRoot, 'manifest.json'), JSON.stringify({
    skills: [
      { name: 'html-report', path: 'html-report' },
      { name: 'weather', path: 'weather' },
    ],
    version: 'bundle-v1',
  }));

  await Promise.all(botInstanceIds.map(async (botInstanceId) => {
    const { workspaceDir } = resolveBotInstancePaths(instancesRoot, botInstanceId);
    await mkdir(workspaceDir, { recursive: true });
  }));

  return { instancesRoot, workspaceRoot };
}

function readBotDocument(
  instancesRoot: string,
  botInstanceId: string,
  fileName: 'AGENTS.md' | 'SOUL.md',
) {
  const { workspaceDir } = resolveBotInstancePaths(instancesRoot, botInstanceId);
  return readFile(path.join(workspaceDir, fileName), 'utf8');
}

async function writeCurrentProjection(
  instancesRoot: string,
  botInstanceId: string,
  managedSkillNames: string[] = ['html-report'],
) {
  const { workspaceDir } = resolveBotInstancePaths(instancesRoot, botInstanceId);
  const managedPaths = resolveManagedSkillsPaths(instancesRoot, botInstanceId);
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(path.dirname(managedPaths.metadataPath), { recursive: true });
  await writeFile(path.join(workspaceDir, 'AGENTS.md'), '# Global AGENTS\n');
  await writeFile(path.join(workspaceDir, 'SOUL.md'), '# Global SOUL\n');
  await writeFile(managedPaths.metadataPath, JSON.stringify({
    bundleVersion: 'bundle-v1',
    lastError: null,
    lastOperation: 'sync-all-managed',
    lastSyncedAt: now.toISOString(),
    lastSyncStatus: 'success',
    managedSkills: managedSkillNames.map((name) => ({
      bundleVersion: 'bundle-v1',
      managedAt: now.toISOString(),
      name,
    })),
    schemaVersion: 1,
    skippedConflicts: [],
  }));
}
