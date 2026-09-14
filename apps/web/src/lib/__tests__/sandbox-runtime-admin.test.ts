import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BotSandboxRuntimePoolRecord } from '@weiling-ai/db';
import { ApiError } from '../api-error';
import {
  listAdminSandboxRuntimePools,
  requestAdminSandboxRuntimePoolRestart,
  updateAdminSandboxRuntimePool,
} from '../sandbox-runtime-admin';

const tempDirs: string[] = [];

const botSandboxRuntimePools = {
  findByBotInstanceId: vi.fn(),
  listAll: vi.fn(),
  requestRestart: vi.fn(),
  updateByBotInstanceId: vi.fn(),
};
const botInstances = {
  findById: vi.fn(),
};
const users = {
  findById: vi.fn(),
};
const repositories = {
  botInstances,
  botSandboxRuntimePools,
  users,
};

beforeEach(() => {
  vi.clearAllMocks();
  botInstances.findById.mockReset();
  botSandboxRuntimePools.findByBotInstanceId.mockReset();
  botSandboxRuntimePools.listAll.mockReset();
  botSandboxRuntimePools.requestRestart.mockReset();
  botSandboxRuntimePools.updateByBotInstanceId.mockReset();
  users.findById.mockReset();
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('sandbox-runtime admin service', () => {
  it('lists configured pools with bot and owner metadata without infrastructure secrets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weiling-srt-admin-status-'));
    tempDirs.push(dir);
    const statusFilePath = join(dir, 'srt-pool-status.json');
    await writeFile(statusFilePath, JSON.stringify({
      manager: {
        cpuPercent: 2.5,
        managedPoolCount: 1,
        pid: 123,
        rssBytes: 128_000_000,
        runningPoolCount: 1,
        state: 'running',
        totalPoolSize: 3,
        uptimeMs: 25_000,
      },
      pools: [
        {
          cpuPercent: 12.5,
          botInstanceId: 'bot_1',
          pid: 456,
          readyProcesses: null,
          rssBytes: 256_000_000,
          state: 'running',
        },
      ],
      updatedAt: '2026-05-02T02:00:00.000Z',
      version: 2,
    }));

    botSandboxRuntimePools.listAll.mockResolvedValue([createPoolRecord()]);
    botInstances.findById.mockResolvedValue({
      id: 'bot_1',
      name: 'Operations Bot',
      ownerUserId: 'user_1',
    });
    users.findById.mockResolvedValue({
      email: 'owner@example.com',
      id: 'user_1',
    });

    const result = await listAdminSandboxRuntimePools({
      repositories,
      statusFilePath,
    });

    expect(result.manager?.state).toBe('running');
    expect(result.pools).toEqual([
      expect.objectContaining({
        botInstanceId: 'bot_1',
        botName: 'Operations Bot',
        ownerEmail: 'owner@example.com',
        ownerUserId: 'user_1',
        runtime: expect.objectContaining({
          cpuPercent: 12.5,
          pid: 456,
          rssBytes: 256_000_000,
          state: 'running',
        }),
      }),
    ]);
    expect(result.pools[0]).not.toHaveProperty('apiKey');
    expect(result.pools[0]).not.toHaveProperty('port');
    expect(result.pools[0]).not.toHaveProperty('portRangeStart');
    expect(result.pools[0]).not.toHaveProperty('workspaceBasePath');
    expect(result.pools[0].runtime).not.toHaveProperty('url');
  });

  it('tolerates a missing runtime status file while still returning configured pools', async () => {
    botSandboxRuntimePools.listAll.mockResolvedValue([createPoolRecord()]);
    botInstances.findById.mockResolvedValue(null);
    users.findById.mockResolvedValue(null);

    const result = await listAdminSandboxRuntimePools({
      repositories,
      statusFilePath: join(tmpdir(), 'missing-weclaws-srt-status.json'),
    });

    expect(result.manager).toBeNull();
    expect(result.pools[0]).toEqual(expect.objectContaining({
      ownerEmail: null,
      botName: null,
      runtime: null,
    }));
  });

  it('rejects patch payloads that try to write API key material', async () => {
    await expect(updateAdminSandboxRuntimePool({
      botInstanceId: 'bot_1',
      payload: {
        apiKey: 'secret',
      },
      repositories,
    })).rejects.toMatchObject({
      code: 'SRT_POOL_INVALID_CONFIG',
      status: 400,
    });
    expect(botSandboxRuntimePools.updateByBotInstanceId).not.toHaveBeenCalled();
  });

  it('sanitizes fatal linux deny paths before returning or persisting pool config', async () => {
    botSandboxRuntimePools.listAll.mockResolvedValue([createPoolRecord({
      defaultDenyRead: ['/etc/passwd', '/etc/mtab', '/proc/mounts'],
    })]);
    users.findById.mockResolvedValue(null);
    botSandboxRuntimePools.updateByBotInstanceId.mockResolvedValue(createPoolRecord({
      defaultDenyRead: ['/etc/passwd', '/proc/mounts'],
    }));

    const listResult = await listAdminSandboxRuntimePools({
      repositories,
      statusFilePath: join(tmpdir(), 'missing-weclaws-srt-status.json'),
    });
    expect(listResult.pools[0].defaultDenyRead).toEqual([
      '/etc/passwd',
      '/proc/mounts',
    ]);

    await updateAdminSandboxRuntimePool({
      botInstanceId: 'bot_1',
      payload: {
        defaultDenyRead: ['/etc/passwd', '/etc/mtab', '/proc/mounts'],
      },
      repositories,
    });

    expect(botSandboxRuntimePools.updateByBotInstanceId).toHaveBeenCalledWith('bot_1', {
      defaultDenyRead: ['/etc/passwd', '/proc/mounts'],
    });
  });

  it('rejects port allocation updates from the browser API', async () => {
    await expect(updateAdminSandboxRuntimePool({
      botInstanceId: 'bot_1',
      payload: {
        port: 31_001,
      },
      repositories,
    })).rejects.toMatchObject({
      code: 'SRT_POOL_INVALID_CONFIG',
      status: 400,
    });
    expect(botSandboxRuntimePools.updateByBotInstanceId).not.toHaveBeenCalled();
  });

  it('rejects updates that try to change workspaceBasePath directly', async () => {
    await expect(updateAdminSandboxRuntimePool({
      botInstanceId: 'bot_1',
      payload: {
        workspaceBasePath: '/tmp/other-user',
      },
      repositories,
    })).rejects.toMatchObject({
      code: 'SRT_POOL_INVALID_CONFIG',
      status: 400,
    });

    expect(botSandboxRuntimePools.updateByBotInstanceId).not.toHaveBeenCalled();
  });

  it('rejects updates when minReadyProcesses exceeds poolSize', async () => {
    await expect(updateAdminSandboxRuntimePool({
      botInstanceId: 'bot_1',
      payload: {
        minReadyProcesses: 4,
        poolSize: 3,
      },
      repositories,
    })).rejects.toMatchObject({
      code: 'SRT_POOL_INVALID_CONFIG',
      status: 400,
    });

    expect(botSandboxRuntimePools.updateByBotInstanceId).not.toHaveBeenCalled();
  });

  it('requests a pool restart through the repository', async () => {
    botSandboxRuntimePools.requestRestart.mockResolvedValue(createPoolRecord({
      restartRequestedAt: new Date('2026-05-02T03:00:00.000Z'),
    }));

    const result = await requestAdminSandboxRuntimePoolRestart({
      botInstanceId: 'bot_1',
      repositories,
    });

    expect(botSandboxRuntimePools.requestRestart).toHaveBeenCalledWith('bot_1', expect.any(Date));
    expect(result.restartRequestedAt).toBe('2026-05-02T03:00:00.000Z');
  });

  it('returns not found when a restart targets an unknown pool', async () => {
    botSandboxRuntimePools.requestRestart.mockResolvedValue(null);

    await expect(requestAdminSandboxRuntimePoolRestart({
      botInstanceId: 'missing_bot',
      repositories,
    })).rejects.toEqual(new ApiError({
      code: 'SRT_POOL_NOT_FOUND',
      message: 'Sandbox runtime pool not found.',
      status: 404,
    }));
  });
});

function createPoolRecord(overrides: Partial<BotSandboxRuntimePoolRecord> = {}): BotSandboxRuntimePoolRecord {
  return {
    ...createBasePoolRecord(),
    ...overrides,
  };
}

function createBasePoolRecord(): BotSandboxRuntimePoolRecord {
  return {
    apiKey: 'secret',
    botInstanceId: 'bot_1',
    createdAt: new Date('2026-05-02T01:00:00.000Z'),
    defaultAllowRead: [],
    defaultAllowWrite: ['/tmp'],
    defaultDeniedDomains: [],
    defaultDenyRead: ['/etc/passwd'],
    defaultDenyWrite: ['.env'],
    enabled: true,
    healthCheckIntervalMs: 60_000,
    id: 'pool_1',
    maxConcurrentInit: 1,
    minReadyProcesses: 1,
    poolSize: 3,
    port: 31_000,
    portRangeEnd: 9_199,
    portRangeStart: 9_100,
    restartRequestedAt: null,
    sessionTimeoutMs: 600_000,
    updatedAt: new Date('2026-05-02T01:10:00.000Z'),
    workspaceBasePath: '/app/apps/sandbox-runtime/user-workspaces/bot_1',
  };
}
