import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { BotSandboxRuntimePoolRecord } from '@weiling-ai/db';
import {
  createSandboxRuntimePoolConfigDocument,
  writeSandboxRuntimePoolConfigFile,
} from '../srt-pool-config-file';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('srt-pool-config-file', () => {
  it('renders enabled and disabled pools into a stable config document', () => {
    const pools = [
      createPoolFixture({ botInstanceId: 'bot_b', port: 31_001 }),
      createPoolFixture({ botInstanceId: 'bot_a', port: 31_000 }),
    ];

    const document = createSandboxRuntimePoolConfigDocument({
      now: new Date('2026-05-02T00:00:00.000Z'),
      pools,
      serviceHost: 'sandbox-runtime',
      workspaceMapDir: '/app/storage/sandbox-runtime-private/workspace-map',
    });

    expect(document).toMatchObject({
      updatedAt: '2026-05-02T00:00:00.000Z',
      version: 2,
    });
    expect(document.pools.map((pool) => pool.botInstanceId)).toEqual(['bot_a', 'bot_b']);
    expect(document.pools[0]).toMatchObject({
      apiKey: 'api-key-bot_a',
      botInstanceId: 'bot_a',
      defaultAllowWrite: ['/tmp'],
      enabled: true,
      url: 'http://sandbox-runtime:31000',
      workspaceMapFile: join('/app/storage/sandbox-runtime-private/workspace-map', 'bot_a.json'),
    });
  });

  it('writes the config file atomically with secrets preserved for the private volume', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-srt-config-'));
    tempDirs.push(dir);

    const filePath = join(dir, 'private', 'srt-pools.json');
    await writeSandboxRuntimePoolConfigFile({
      filePath,
      now: new Date('2026-05-02T00:00:00.000Z'),
      pools: [createPoolFixture({ botInstanceId: 'bot_1' })],
      serviceHost: 'sandbox-runtime',
      workspaceMapDir: join(dir, 'private', 'workspace-map'),
    });

    const document = JSON.parse(await readFile(filePath, 'utf8')) as {
      pools: Array<{ apiKey?: string; workspaceMapFile?: string }>;
    };

    expect(document.pools[0].apiKey).toBe('api-key-bot_1');
    expect(document.pools[0].workspaceMapFile).toBe(join(dir, 'private', 'workspace-map', 'bot_1.json'));
  });

  it('strips fatal linux deny paths from persisted pool config', () => {
    const document = createSandboxRuntimePoolConfigDocument({
      now: new Date('2026-05-02T00:00:00.000Z'),
      pools: [createPoolFixture({
        defaultDenyRead: ['/etc/passwd', '/etc/mtab', '/proc/mounts'],
      })],
      serviceHost: 'sandbox-runtime',
      workspaceMapDir: '/app/storage/sandbox-runtime-private/workspace-map',
    });

    expect(document.pools[0].defaultDenyRead).toEqual([
      '/etc/passwd',
      '/proc/mounts',
    ]);
  });
});

function createPoolFixture(
  overrides: Partial<BotSandboxRuntimePoolRecord> = {},
): BotSandboxRuntimePoolRecord {
  const botInstanceId = overrides.botInstanceId ?? 'bot_1';
  return {
    apiKey: `api-key-${botInstanceId}`,
    botInstanceId,
    createdAt: new Date('2026-05-02T00:00:00.000Z'),
    defaultAllowRead: [],
    defaultAllowWrite: ['/tmp'],
    defaultDeniedDomains: [],
    defaultDenyRead: ['/etc/passwd'],
    defaultDenyWrite: ['.env'],
    enabled: true,
    healthCheckIntervalMs: 60_000,
    id: `pool_${botInstanceId}`,
    maxConcurrentInit: 1,
    minReadyProcesses: 1,
    poolSize: 3,
    port: 31_000,
    portRangeEnd: 9_199,
    portRangeStart: 9_100,
    restartRequestedAt: null,
    sessionTimeoutMs: 600_000,
    updatedAt: new Date('2026-05-02T00:00:00.000Z'),
    workspaceBasePath: `/app/apps/sandbox-runtime/user-workspaces/${botInstanceId}`,
    ...overrides,
  };
}
