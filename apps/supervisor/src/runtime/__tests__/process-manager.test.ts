import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  BotEventRepository,
  BotInstanceRepository,
  BotSandboxRuntimePoolRepository,
  UserLlmProfileRepository,
  UserRepository,
  WorkspaceRepository,
  migrateDatabase,
} from '@weiling-ai/db';
import {
  closeTrackedDatabaseClients,
  createTrackedDatabaseClient as createDatabaseClient,
} from './test-database-client';
import { parseSandboxRuntimePoolDefaults, resolveBotInstancePaths } from '@weiling-ai/shared';
import { acquireManagedSkillsLock, resolveManagedSkillsLockPath } from '@weiling-ai/shared/managed-skills';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupervisorConfig } from '../../config';
import { ProcessManager } from '../process-manager';
import {
  createScriptedFastAgentBinary,
  RESTORED_ACCOUNT_ID,
  type ScriptedFastAgentScenario,
} from './scripted-fastagent';

const tempDirs: string[] = [];

afterEach(async () => {
  closeTrackedDatabaseClients();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('ProcessManager', () => {
  it.skipIf(process.platform === 'win32')(
    'spawns the mock runtime once, forwards stdout events, and stops gracefully',
    async () => {
    const { botEvents, botInstances, bot, botSandboxRuntimePools, config, processManager } = await createProcessManagerHarness();

    expect(await processManager.startInstance(bot, {
      mockScenario: 'happy',
      stepDelayMs: 10,
    })).toBe(true);
    expect(await processManager.startInstance(bot, {
      mockScenario: 'happy',
      stepDelayMs: 10,
    })).toBe(false);

    await waitFor(async () => {
      const current = await botInstances.findById('bot_1');
      return current?.status === 'running';
    });

    const runningBot = await botInstances.findById('bot_1');
    const pool = await botSandboxRuntimePools.findByBotInstanceId('bot_1');
    const timeline = await botEvents.listByBotInstanceId('bot_1');

    expect(processManager.hasInstance('bot_1')).toBe(true);
    expect(pool).toMatchObject({
      botInstanceId: 'bot_1',
      port: 31_000,
    });
    expect(runningBot).toMatchObject({
      lastQrCodeUrl: 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=00000000000000000000000000000000&bot_type=3',
      processPid: expect.any(Number),
      status: 'running',
      weixinAccountId: 'wx_acc_1',
    });
    expect(timeline.map((event) => event.type)).toEqual(
      expect.arrayContaining(['process_started', 'qr_code', 'login_confirmed', 'running']),
    );

    await botInstances.setDesiredState('bot_1', 'stopped');
    expect(await processManager.stopInstance('bot_1')).toBe(true);

    await waitFor(async () => {
      const current = await botInstances.findById('bot_1');
      return current?.status === 'stopped' && !processManager.hasInstance('bot_1');
    });

    const stoppedBot = await botInstances.findById('bot_1');

    expect(stoppedBot).toMatchObject({
      processPid: null,
      processStartedAt: null,
      status: 'stopped',
    });

    await processManager.dispose();
    void config;
    },
  );

  it('marks the bot failed when its sandbox runtime pool is disabled', async () => {
    const { bot, botInstances, processManager } = await createProcessManagerHarness({
      disabledSandboxPool: true,
    });

    expect(await processManager.startInstance(bot)).toBe(false);

    const failedBot = await botInstances.findById('bot_1');

    expect(failedBot).toMatchObject({
      lastErrorCode: 'SRT_POOL_DISABLED',
      processPid: null,
      status: 'failed',
    });
    expect(processManager.hasInstance('bot_1')).toBe(false);

    await processManager.dispose();
  });

  it('cleans up crashed children and leaves restart scheduling to the database state', async () => {
    const { botInstances, bot, processManager } = await createProcessManagerHarness();

    expect(await processManager.startInstance(bot, {
      mockScenario: 'crash_after_running',
      stepDelayMs: 10,
    })).toBe(true);

    await waitFor(async () => {
      const current = await botInstances.findById('bot_1');
      return current?.restartCount === 1 && current.status === 'stopped' && !processManager.hasInstance('bot_1');
    }, 10_000);

    const crashedBot = await botInstances.findById('bot_1');

    expect(crashedBot).toMatchObject({
      lastErrorCode: 'RUNTIME_ERROR',
      restartBackoffUntil: expect.any(Date),
      restartCount: 1,
      status: 'stopped',
    });

    await processManager.dispose();
  });

  it('force-terminates a child that emits stopped without exiting', async () => {
    const { botEvents, botInstances, bot, processManager } = await createProcessManagerHarness({
      binaryScenario: 'stopped_without_exit_once',
    });

    expect(await processManager.startInstance(bot)).toBe(true);

    await waitFor(async () => {
      const current = await botInstances.findById('bot_1');
      return current?.restartCount === 1
        && current.status === 'stopped'
        && !processManager.hasInstance('bot_1');
    });

    const stoppedBot = await botInstances.findById('bot_1');
    const timeline = await botEvents.listByBotInstanceId('bot_1');

    expect(stoppedBot).toMatchObject({
      restartBackoffUntil: expect.any(Date),
      restartCount: 1,
      status: 'stopped',
    });
    expect(timeline.filter((event) => event.type === 'runtime_error')).toHaveLength(1);
    expect(timeline.filter((event) => event.type === 'stopped')).toHaveLength(1);

    await processManager.dispose();
  });

  it('marks the bot failed when the real FastAgent binary cannot be started', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { bot, botEvents, botInstances, botSandboxRuntimePools, config, userLlmProfiles } = await createProcessManagerHarness();
    const missingBinaryPath = join('/definitely-missing', 'fastagent');
    const processManager = new ProcessManager({
      botEvents,
      botInstances,
      config: {
        ...config,
        fastagentBinaryPath: missingBinaryPath,
      },
      botSandboxRuntimePools,
      userLlmProfiles,
    });

    try {
      await expect(processManager.startInstance(bot)).resolves.toBe(false);
      expect(processManager.hasInstance('bot_1')).toBe(false);

      const failedBot = await botInstances.findById('bot_1');

      expect(failedBot).toMatchObject({
        lastErrorCode: 'FASTAGENT_START_FAILED',
        lastErrorMessage: 'FastAgent runtime could not be started.',
        processPid: null,
        status: 'failed',
      });
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('marks the bot failed when no llm profile is bound instead of using FASTAGENT env defaults', async () => {
    const { bot, botInstances, processManager } = await createProcessManagerHarness({
      bindProfile: false,
    });

    expect(await processManager.startInstance(bot)).toBe(false);

    const failedBot = await botInstances.findById('bot_1');

    expect(failedBot).toMatchObject({
      lastErrorCode: 'LLM_PROFILE_REQUIRED',
      processPid: null,
      status: 'failed',
    });
    expect(processManager.hasInstance('bot_1')).toBe(false);

    await processManager.dispose();
  });

  it('marks the bot failed when the bound llm profile is incomplete', async () => {
    const { bot, botInstances, processManager } = await createProcessManagerHarness({
      profileOverrides: {
        apiKey: '',
        model: '',
        provider: '',
      },
    });

    expect(await processManager.startInstance(bot)).toBe(false);

    const failedBot = await botInstances.findById('bot_1');

    expect(failedBot).toMatchObject({
      lastErrorCode: 'LLM_PROFILE_INVALID',
      processPid: null,
      status: 'failed',
    });
    expect(processManager.hasInstance('bot_1')).toBe(false);

    await processManager.dispose();
  });

  it('keeps registry ownership until restored crash events finish applying', async () => {
    const { botInstances, bot, processManager } = await createProcessManagerHarness({
      applyDelayMs: 120,
      binaryScenario: 'restored_crash',
    });

    expect(await processManager.startInstance(bot)).toBe(true);

    await delay(100);
    expect(processManager.hasInstance('bot_1')).toBe(true);

    await waitFor(async () => {
      const current = await botInstances.findById('bot_1');
      return current?.restartCount === 1 && current.status === 'stopped' && !processManager.hasInstance('bot_1');
    });

    const crashedBot = await botInstances.findById('bot_1');

    expect(crashedBot).toMatchObject({
      lastErrorCode: 'RUNTIME_ERROR',
      lastErrorMessage: 'Sandbox session crashed unexpectedly',
      restartBackoffUntil: expect.any(Date),
      restartCount: 1,
      status: 'stopped',
      weixinAccountId: RESTORED_ACCOUNT_ID,
    });

    await processManager.dispose();
  }, 15_000);

  it.skipIf(process.platform === 'win32')(
    'stops a restored runtime without treating the stop as a crash',
    async () => {
    const { botEvents, botInstances, bot, processManager } = await createProcessManagerHarness({
      binaryScenario: 'restored_happy',
    });

    expect(await processManager.startInstance(bot)).toBe(true);

    await waitFor(async () => {
      const current = await botInstances.findById('bot_1');
      return current?.status === 'running';
    });

    await botInstances.setDesiredState('bot_1', 'stopped');
    expect(await processManager.stopInstance('bot_1')).toBe(true);

    await waitFor(async () => {
      const current = await botInstances.findById('bot_1');
      return current?.status === 'stopped' && !processManager.hasInstance('bot_1');
    });

    const stoppedBot = await botInstances.findById('bot_1');
    const timeline = await botEvents.listByBotInstanceId('bot_1');

    expect(stoppedBot).toMatchObject({
      lastErrorCode: null,
      processPid: null,
      processStartedAt: null,
      restartBackoffUntil: null,
      restartCount: 0,
      status: 'stopped',
      weixinAccountId: RESTORED_ACCOUNT_ID,
    });
    expect(timeline.map((event) => event.type)).toEqual(
      expect.arrayContaining(['process_started', 'running', 'stopping', 'stopped']),
    );
    expect(timeline.map((event) => event.type)).not.toContain('runtime_error');

    await processManager.dispose();
    },
  );

  it.skipIf(process.platform === 'win32')(
    'terminates runtimes that emit invalid jsonl instead of leaving them running with stale state',
    async () => {
    const { botInstances, bot, processManager } = await createProcessManagerHarness({
      binaryScenario: 'invalid_json' as ScriptedFastAgentScenario,
    });

    expect(await processManager.startInstance(bot)).toBe(true);

    await waitFor(async () => {
      const current = await botInstances.findById('bot_1');
      return current?.restartCount === 1 && current.status === 'stopped' && !processManager.hasInstance('bot_1');
    });

    const failedBot = await botInstances.findById('bot_1');

    expect(failedBot).toMatchObject({
      lastErrorCode: 'RUNTIME_ERROR',
      restartBackoffUntil: expect.any(Date),
      restartCount: 1,
      status: 'stopped',
    });

    await processManager.dispose();
    },
  );

  it.skipIf(process.platform === 'win32')(
    'terminates runtimes when event application throws on malformed runtime output',
    async () => {
    const { botInstances, bot, processManager } = await createProcessManagerHarness({
      binaryScenario: 'missing_qr_url' as ScriptedFastAgentScenario,
    });

    expect(await processManager.startInstance(bot)).toBe(true);

    await waitFor(async () => {
      const current = await botInstances.findById('bot_1');
      return current?.restartCount === 1 && current.status === 'stopped' && !processManager.hasInstance('bot_1');
    });

    const failedBot = await botInstances.findById('bot_1');

    expect(failedBot).toMatchObject({
      lastErrorCode: 'RUNTIME_ERROR',
      restartBackoffUntil: expect.any(Date),
      restartCount: 1,
      status: 'stopped',
    });

    await processManager.dispose();
    },
  );

  it('persists the resolved runtime provider and model snapshot before the bot reaches running', async () => {
    const { bot, botInstances, processManager, userLlmProfiles } = await createProcessManagerHarness();

    await userLlmProfiles.updateByIdForUser('profile_1', 'user_1', {
      apiKey: 'sk-user-1',
      apiType: 'openai-responses',
      baseUrl: 'https://gateway.example.com/v1',
      model: 'gpt-5.5',
      name: 'Primary OpenAI',
      provider: 'openai',
    });

    expect(await processManager.startInstance(bot, {
      mockScenario: 'happy',
      stepDelayMs: 10,
    })).toBe(true);

    await waitFor(async () => {
      const current = await botInstances.findById('bot_1');
      return current?.status === 'running';
    });

    const runningBot = await botInstances.findById('bot_1');

    expect(runningBot).toMatchObject({
      model: 'gpt-5.5',
      provider: 'openai',
    });

    await processManager.dispose();
  });

  it('syncs managed skills before spawning the runtime', async () => {
    const { bot, botInstances, config, processManager } = await createProcessManagerHarness({
      managedBundle: {
        skills: {
          alpha: {
            'SKILL.md': '# Alpha',
          },
        },
        version: 'bundle-v1',
      },
    });

    expect(await processManager.startInstance(bot, {
      mockScenario: 'happy',
      stepDelayMs: 10,
    })).toBe(true);

    await waitFor(async () => {
      const current = await botInstances.findById('bot_1');
      return current?.status === 'running';
    });

    const installedSkill = await readFile(
      join(config.instancesRoot, 'bot_1', 'data', 'skills', 'alpha', 'SKILL.md'),
      'utf8',
    );

    expect(installedSkill).toBe('# Alpha');

    await processManager.dispose();
  });

  it('keeps the global managed-skill filter when syncing before runtime spawn', async () => {
    const { bot, botInstances, config, processManager } = await createProcessManagerHarness({
      enabledManagedSkillNames: ['beta'],
      managedBundle: {
        skills: {
          alpha: { 'SKILL.md': '# Alpha' },
          beta: { 'SKILL.md': '# Beta' },
        },
        version: 'bundle-v1',
      },
    });

    expect(await processManager.startInstance(bot, {
      mockScenario: 'happy',
      stepDelayMs: 10,
    })).toBe(true);

    await waitFor(async () => {
      const current = await botInstances.findById('bot_1');
      return current?.status === 'running';
    });

    await expect(readFile(
      join(config.instancesRoot, 'bot_1', 'data', 'skills', 'beta', 'SKILL.md'),
      'utf8',
    )).resolves.toBe('# Beta');
    await expect(readFile(
      join(config.instancesRoot, 'bot_1', 'data', 'skills', 'alpha', 'SKILL.md'),
      'utf8',
    )).rejects.toMatchObject({ code: 'ENOENT' });

    await processManager.dispose();
  });

  it('keeps startup running when a conflicting user skill is skipped', async () => {
    const { bot, botInstances, config, processManager } = await createProcessManagerHarness({
      managedBundle: {
        skills: {
          alpha: {
            'SKILL.md': '# Alpha managed',
          },
        },
        version: 'bundle-v1',
      },
    });
    const userSkillDir = join(config.instancesRoot, 'bot_1', 'data', 'skills', 'alpha');

    await mkdir(userSkillDir, { recursive: true });
    await writeFile(join(userSkillDir, 'SKILL.md'), '# Alpha user');

    expect(await processManager.startInstance(bot, {
      mockScenario: 'happy',
      stepDelayMs: 10,
    })).toBe(true);

    await waitFor(async () => {
      const current = await botInstances.findById('bot_1');
      return current?.status === 'running';
    });

    await expect(readFile(join(userSkillDir, 'SKILL.md'), 'utf8')).resolves.toBe('# Alpha user');

    await processManager.dispose();
  });

  it('continues startup when managed skill sync returns an error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { bot, botInstances, processManager } = await createProcessManagerHarness({
      invalidManagedManifest: true,
      managedBundle: {
        skills: {
          alpha: {
            'SKILL.md': '# Alpha',
          },
        },
        version: 'bundle-v1',
      },
    });

    try {
      expect(await processManager.startInstance(bot, {
        mockScenario: 'happy',
        stepDelayMs: 10,
      })).toBe(true);

      await waitFor(async () => {
        const current = await botInstances.findById('bot_1');
        return current?.status === 'running';
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Managed skills sync failed for bot_1'),
      );
    } finally {
      consoleErrorSpy.mockRestore();
      await processManager.dispose();
    }
  });

  it('skips the current sync attempt when the bot-scoped lock is already busy', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { bot, botInstances, config, processManager } = await createProcessManagerHarness({
      managedBundle: {
        skills: {
          alpha: {
            'SKILL.md': '# Alpha',
          },
        },
        version: 'bundle-v1',
      },
    });
    const lockHandle = await acquireManagedSkillsLock(resolveManagedSkillsLockPath(
      config.instancesRoot,
      bot.id,
    ));

    try {
      expect(await processManager.startInstance(bot, {
        mockScenario: 'happy',
        stepDelayMs: 10,
      })).toBe(true);

      await waitFor(async () => {
        const current = await botInstances.findById('bot_1');
        return current?.status === 'running';
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Managed skills sync already in progress for bot_1'),
      );
      await expect(readFile(
        join(config.instancesRoot, 'bot_1', 'data', 'skills', 'alpha', 'SKILL.md'),
        'utf8',
      )).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      consoleWarnSpy.mockRestore();
      await lockHandle?.release();
      await processManager.dispose();
    }
  });
});

async function createProcessManagerHarness(input: {
  applyDelayMs?: number;
  binaryScenario?: ScriptedFastAgentScenario;
  bindProfile?: boolean;
  disabledSandboxPool?: boolean;
  enabledManagedSkillNames?: readonly string[];
  invalidProfileBinding?: boolean;
  invalidManagedManifest?: boolean;
  managedBundle?: {
    skills: Record<string, Record<string, string>>;
    version: string;
  };
  profileOverrides?: Partial<{
    apiKey: string;
    apiType: string | null;
    baseUrl: string | null;
    model: string;
    name: string;
    provider: string;
  }>;
} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-process-manager-'));
  tempDirs.push(dir);

  const client = createDatabaseClient({
    url: `file:${join(dir, 'test.sqlite')}`,
  });
  migrateDatabase(client);

  const users = new UserRepository(client.db);
  const userLlmProfiles = new UserLlmProfileRepository(client.db);
  const botSandboxRuntimePools = new BotSandboxRuntimePoolRepository(client.db);
  const workspaces = new WorkspaceRepository(client.db);
  const botInstances = new BotInstanceRepository(client.db);
  const botEvents = new BotEventRepository(client.db);

  await users.create({
    email: 'zac@example.com',
    id: 'user_1',
    name: 'zac',
  });

  const instancesRoot = join(dir, 'instances');
  const instancePaths = resolveBotInstancePaths(instancesRoot, 'bot_1');
  const fastagentBinaryPath = input.binaryScenario
    ? await createScriptedFastAgentBinary(dir, input.binaryScenario)
    : '/usr/local/bin/fastagent';

  await Promise.all([
    mkdir(instancePaths.workspaceDir, { recursive: true }),
    mkdir(instancePaths.dataDir, { recursive: true }),
    mkdir(instancePaths.logDir, { recursive: true }),
  ]);
  await writeManagedBundle(dir, input.managedBundle, input.invalidManagedManifest === true);

  await workspaces.create({
    id: 'ws_1',
    name: 'Workspace',
    ownerUserId: 'user_1',
  });

  const llmConfigId = input.bindProfile === false
    ? null
    : input.invalidProfileBinding === true
      ? 'missing_profile'
      : 'profile_1';

  if (llmConfigId === 'profile_1') {
    await userLlmProfiles.create({
      apiKey: 'sk-test',
      apiType: null,
      baseUrl: null,
      id: 'profile_1',
      model: 'claude-opus-4-6',
      name: 'Primary Anthropic',
      provider: 'anthropic',
      userId: 'user_1',
      ...input.profileOverrides,
    });
  }

  await botInstances.create({
    id: 'bot_1',
    llmConfigId,
    model: 'claude-opus-4-6',
    name: 'Bot One',
    ownerUserId: 'user_1',
    provider: 'anthropic',
    desiredState: 'running',
    status: 'provisioning',
    workspaceId: 'ws_1',
  });

  if (input.disabledSandboxPool === true) {
    await botSandboxRuntimePools.ensureForBot({
      botInstanceId: 'bot_1',
      defaults: parseSandboxRuntimePoolDefaults({}),
    });
    await botSandboxRuntimePools.updateByBotInstanceId('bot_1', {
      enabled: false,
    });
  }

  const bot = await botInstances.findById('bot_1');

  if (!bot) {
    throw new Error('Expected bot fixture to exist.');
  }

  const config: SupervisorConfig = {
    databaseUrl: `file:${join(dir, 'test.sqlite')}`,
    fastagentBinaryPath,
    internalApiToken: '',
    internalPort: 8790,
    instancesRoot,
    larkConfigRoot: instancesRoot,
    larkCliPath: 'lark-cli',
    mockFastAgentFixturePath: fileURLToPath(
      new URL('../../../../../tests/fixtures/mock-fastagent.ts', import.meta.url),
    ),
    reconcileIntervalMs: 50,
    reconcileStallTimeoutMs: 120_000,
    sandboxMode: 'remote',
    sandboxApiKey: null,
    sandboxUrl: null,
    srtPoolConfigFile: join(instancesRoot, '.sandbox-runtime', 'srt-pools.json'),
    srtPoolDefaults: parseSandboxRuntimePoolDefaults({}),
    srtPoolStatusFile: join(instancesRoot, '.sandbox-runtime', 'srt-pool-status.json'),
    srtServiceHost: 'sandbox-runtime',
    srtWorkspaceMapDir: join(instancesRoot, '.sandbox-runtime', 'workspace-map'),
    workspaceRoot: dir,
  };

  return {
    bot,
    botEvents,
    botInstances,
    config,
    userLlmProfiles,
    botSandboxRuntimePools,
    processManager: new ProcessManager({
      botEvents: wrapAsyncRepository(botEvents, input.applyDelayMs),
      botInstances: wrapAsyncRepository(botInstances, input.applyDelayMs),
      config,
      resolveEnabledManagedSkillNames: input.enabledManagedSkillNames === undefined
        ? undefined
        : async () => input.enabledManagedSkillNames ?? [],
      botSandboxRuntimePools,
      userLlmProfiles,
    }),
  };
}

async function writeManagedBundle(
  workspaceRoot: string,
  bundle: {
    skills: Record<string, Record<string, string>>;
    version: string;
  } | undefined,
  invalidManifest: boolean,
) {
  const bundleRoot = join(workspaceRoot, 'resources', 'skills', 'managed');
  const nextBundle = bundle ?? {
    skills: {},
    version: 'bundle-v0',
  };

  await mkdir(bundleRoot, { recursive: true });
  await Promise.all(Object.entries(nextBundle.skills).map(async ([skillName, files]) => {
    const skillRoot = join(bundleRoot, skillName);
    await mkdir(skillRoot, { recursive: true });

    await Promise.all(Object.entries(files).map(async ([relativePath, content]) => {
      const filePath = join(skillRoot, relativePath);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }));
  }));

  if (invalidManifest) {
    await writeFile(join(bundleRoot, 'manifest.json'), '{');
    return;
  }

  await writeFile(join(bundleRoot, 'manifest.json'), JSON.stringify({
    skills: Object.keys(nextBundle.skills).map((skillName) => ({
      name: skillName,
      path: skillName,
    })),
    version: nextBundle.version,
  }, null, 2));
}

function wrapAsyncRepository<T extends object>(repository: T, delayMs: number | undefined): T {
  if (!delayMs || delayMs <= 0) {
    return repository;
  }

  return new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);

      if (typeof value !== 'function') {
        return value;
      }

      return async (...args: unknown[]) => {
        await delay(delayMs);
        return Reflect.apply(value, target, args);
      };
    },
  });
}

function delay(durationMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number = 5_000) {
  const start = Date.now();

  while (Date.now() - start <= timeoutMs) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }

  throw new Error('Timed out waiting for condition.');
}
