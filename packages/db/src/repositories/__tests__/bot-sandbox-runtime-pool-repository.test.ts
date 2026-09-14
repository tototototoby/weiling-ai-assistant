import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SandboxRuntimePoolDefaults } from '@weiling-ai/shared';
import { createDatabaseClient, migrateDatabase } from '../../client.js';
import { BotInstanceRepository } from '../bot-instance-repository.js';
import { BotSandboxRuntimePoolRepository } from '../bot-sandbox-runtime-pool-repository.js';
import { UserRepository } from '../user-repository.js';
import { UserSandboxRuntimePoolRepository } from '../user-sandbox-runtime-pool-repository.js';
import { WorkspaceRepository } from '../workspace-repository.js';

const tempDirs: string[] = [];
const clients: Array<ReturnType<typeof createDatabaseClient>> = [];

afterEach(async () => {
  clients.splice(0).forEach((client) => client.close());
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('BotSandboxRuntimePoolRepository', () => {
  it('provisions one isolated pool per Bot with non-overlapping ports and Bot-scoped paths', async () => {
    const { pools } = await createRepositoryFixture();

    const first = await pools.ensureForBot({
      botInstanceId: 'bot_1',
      defaults: createTestDefaults(),
      now: new Date('2026-07-24T00:00:00.000Z'),
    });
    const second = await pools.ensureForBot({
      botInstanceId: 'bot_2',
      defaults: createTestDefaults(),
      now: new Date('2026-07-24T00:01:00.000Z'),
    });
    const third = await pools.ensureForBot({
      botInstanceId: 'bot_3',
      defaults: createTestDefaults(),
      now: new Date('2026-07-24T00:02:00.000Z'),
    });

    expect(first).toMatchObject({
      botInstanceId: 'bot_1',
      defaultAllowWrite: ['/tmp'],
      defaultDenyRead: ['/etc/passwd'],
      enabled: true,
      minReadyProcesses: 1,
      poolSize: 1,
      port: 31_000,
      portRangeEnd: 9_119,
      portRangeStart: 9_100,
      workspaceBasePath: '/app/apps/sandbox-runtime/user-workspaces/bot_1',
    });
    expect(second).toMatchObject({
      botInstanceId: 'bot_2',
      port: 31_001,
      portRangeEnd: 9_139,
      portRangeStart: 9_120,
      workspaceBasePath: '/app/apps/sandbox-runtime/user-workspaces/bot_2',
    });
    expect(third).toMatchObject({
      botInstanceId: 'bot_3',
      port: 31_002,
      portRangeEnd: 9_159,
      portRangeStart: 9_140,
    });
    expect(new Set([first.apiKey, second.apiKey, third.apiKey]).size).toBe(3);
    expect(first.apiKey).toHaveLength(64);
    expect(await pools.listAll()).toHaveLength(3);
  });

  it('returns the existing Bot pool without rotating secrets or applying later defaults', async () => {
    const { pools } = await createRepositoryFixture();
    const first = await pools.ensureForBot({
      botInstanceId: 'bot_1',
      defaults: createTestDefaults(),
    });
    const second = await pools.ensureForBot({
      botInstanceId: 'bot_1',
      defaults: {
        ...createTestDefaults(),
        poolSize: 4,
      },
    });

    expect(second).toEqual(first);
  });

  it('does not read or allocate against the retained legacy user pool table', async () => {
    const { legacyPools, pools } = await createRepositoryFixture();
    await legacyPools.ensureForUser({
      defaults: {
        ...createTestDefaults(),
        minReadyProcesses: 2,
        poolSize: 3,
        workspaceBaseRoot: '/legacy/user-pools',
      },
      ownerUserId: 'user_1',
    });

    const created = await pools.ensureForBot({
      botInstanceId: 'bot_1',
      defaults: createTestDefaults(),
    });

    expect(created).toMatchObject({
      botInstanceId: 'bot_1',
      minReadyProcesses: 1,
      poolSize: 1,
      port: 31_000,
      workspaceBasePath: '/app/apps/sandbox-runtime/user-workspaces/bot_1',
    });
    expect(await legacyPools.listAll()).toHaveLength(1);
  });

  it('updates one Bot pool and rejects capacity, child-port, and proxy-range conflicts', async () => {
    const { pools } = await createRepositoryFixture();
    await pools.ensureForBot({ botInstanceId: 'bot_1', defaults: createTestDefaults() });
    await pools.ensureForBot({ botInstanceId: 'bot_2', defaults: createTestDefaults() });

    const updated = await pools.updateByBotInstanceId('bot_1', {
      enabled: false,
      healthCheckIntervalMs: 30_000,
      updatedAt: new Date('2026-07-24T00:03:00.000Z'),
    });
    expect(updated).toMatchObject({
      enabled: false,
      healthCheckIntervalMs: 30_000,
    });

    await expect(pools.updateByBotInstanceId('bot_1', {
      minReadyProcesses: 2,
      poolSize: 1,
    })).rejects.toThrow('Bot SRT pool minReadyProcesses must be <= poolSize.');
    await expect(pools.updateByBotInstanceId('bot_1', {
      port: 31_001,
    })).rejects.toThrow('Bot SRT pool port is already used by another pool.');
    await expect(pools.updateByBotInstanceId('bot_1', {
      portRangeEnd: 9_125,
      portRangeStart: 9_115,
    })).rejects.toThrow('Bot SRT pool proxy port range overlaps another pool.');
  });

  it('marks only the requested Bot pool for restart and cascades deletion with the Bot', async () => {
    const { pools, workspaces } = await createRepositoryFixture();
    await pools.ensureForBot({ botInstanceId: 'bot_1', defaults: createTestDefaults() });
    await pools.ensureForBot({ botInstanceId: 'bot_3', defaults: createTestDefaults() });

    const restartAt = new Date('2026-07-24T00:04:00.000Z');
    const restarted = await pools.requestRestart('bot_1', restartAt);
    const untouched = await pools.findByBotInstanceId('bot_3');

    expect(restarted?.restartRequestedAt).toEqual(restartAt);
    expect(untouched?.restartRequestedAt).toBeNull();

    expect(await workspaces.deleteById('ws_1')).toBe(true);
    expect(await pools.findByBotInstanceId('bot_1')).toBeNull();
    expect(await pools.findByBotInstanceId('bot_3')).not.toBeNull();
  });
});

async function createRepositoryFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-bot-srt-pool-'));
  tempDirs.push(dir);

  const client = createDatabaseClient({
    url: `file:${join(dir, 'test.sqlite')}`,
  });
  clients.push(client);
  migrateDatabase(client);

  const users = new UserRepository(client.db);
  const workspaces = new WorkspaceRepository(client.db);
  const bots = new BotInstanceRepository(client.db);

  await users.create({ email: 'first@example.com', id: 'user_1', name: 'first' });
  await users.create({ email: 'second@example.com', id: 'user_2', name: 'second' });
  await workspaces.create({ id: 'ws_1', name: 'First', ownerUserId: 'user_1' });
  await workspaces.create({ id: 'ws_2', name: 'Second', ownerUserId: 'user_2' });

  await bots.create({
    desiredState: 'running',
    id: 'bot_1',
    model: 'model',
    name: 'Bot One',
    ownerUserId: 'user_1',
    provider: 'provider',
    status: 'provisioning',
    workspaceId: 'ws_1',
  });
  await bots.create({
    desiredState: 'running',
    id: 'bot_2',
    model: 'model',
    name: 'Bot Two',
    ownerUserId: 'user_1',
    provider: 'provider',
    status: 'provisioning',
    workspaceId: 'ws_1',
  });
  await bots.create({
    desiredState: 'running',
    id: 'bot_3',
    model: 'model',
    name: 'Bot Three',
    ownerUserId: 'user_2',
    provider: 'provider',
    status: 'provisioning',
    workspaceId: 'ws_2',
  });

  return {
    legacyPools: new UserSandboxRuntimePoolRepository(client.db),
    pools: new BotSandboxRuntimePoolRepository(client.db),
    workspaces,
  };
}

function createTestDefaults(): SandboxRuntimePoolDefaults {
  return {
    defaultAllowRead: [],
    defaultAllowWrite: ['/tmp'],
    defaultDeniedDomains: [],
    defaultDenyRead: ['/etc/passwd'],
    defaultDenyWrite: ['.env'],
    healthCheckIntervalMs: 60_000,
    maxConcurrentInit: 1,
    minReadyProcesses: 1,
    poolSize: 1,
    portBase: 31_000,
    portRangeWidth: 20,
    proxyPortBase: 9_100,
    sessionTimeoutMs: 600_000,
    workspaceBaseRoot: '/app/apps/sandbox-runtime/user-workspaces',
  };
}
