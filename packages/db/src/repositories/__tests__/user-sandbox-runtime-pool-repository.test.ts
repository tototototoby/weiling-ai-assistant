import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SandboxRuntimePoolDefaults } from '@weiling-ai/shared';
import { migrateDatabase } from '../../client.js';
import {
  closeTrackedDatabaseClients,
  createTrackedDatabaseClient as createDatabaseClient,
} from './test-database-client.js';
import { UserRepository } from '../user-repository.js';
import { UserSandboxRuntimePoolRepository } from '../user-sandbox-runtime-pool-repository.js';

const tempDirs: string[] = [];

afterEach(async () => {
  closeTrackedDatabaseClients();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('UserSandboxRuntimePoolRepository', () => {
  it('provisions one sandbox runtime pool per user with non-overlapping ports', async () => {
    const { pools } = await createRepositoryFixture();

    const first = await pools.ensureForUser({
      defaults: createTestDefaults(),
      now: new Date('2026-05-02T00:00:00.000Z'),
      ownerUserId: 'user_1',
    });
    const second = await pools.ensureForUser({
      defaults: createTestDefaults(),
      now: new Date('2026-05-02T00:01:00.000Z'),
      ownerUserId: 'user_2',
    });

    expect(first).toMatchObject({
      defaultAllowRead: [],
      defaultAllowWrite: ['/tmp'],
      defaultDeniedDomains: [],
      defaultDenyRead: ['/etc/passwd'],
      defaultDenyWrite: ['.env'],
      enabled: true,
      healthCheckIntervalMs: 60_000,
      maxConcurrentInit: 1,
      minReadyProcesses: 1,
      ownerUserId: 'user_1',
      poolSize: 3,
      port: 31_000,
      portRangeEnd: 9_199,
      portRangeStart: 9_100,
      sessionTimeoutMs: 600_000,
      workspaceBasePath: '/app/apps/sandbox-runtime/user-workspaces/user_1',
    });
    expect(first.apiKey).toHaveLength(64);
    expect(second).toMatchObject({
      ownerUserId: 'user_2',
      port: 31_001,
      portRangeEnd: 9_299,
      portRangeStart: 9_200,
      workspaceBasePath: '/app/apps/sandbox-runtime/user-workspaces/user_2',
    });
    expect(second.apiKey).toHaveLength(64);
    expect(second.apiKey).not.toBe(first.apiKey);
  });

  it('returns the existing pool without rotating secrets when ensuring twice', async () => {
    const { pools } = await createRepositoryFixture();

    const first = await pools.ensureForUser({
      defaults: createTestDefaults(),
      ownerUserId: 'user_1',
    });
    const second = await pools.ensureForUser({
      defaults: {
        ...createTestDefaults(),
        poolSize: 5,
      },
      ownerUserId: 'user_1',
    });

    expect(second).toEqual(first);
  });

  it('updates capacity and disabled state through a narrow owner-scoped API', async () => {
    const { pools } = await createRepositoryFixture();
    await pools.ensureForUser({
      defaults: createTestDefaults(),
      ownerUserId: 'user_1',
    });

    const updated = await pools.updateByOwnerUserId('user_1', {
      enabled: false,
      minReadyProcesses: 2,
      poolSize: 4,
      updatedAt: new Date('2026-05-02T00:02:00.000Z'),
    });
    const found = await pools.findByOwnerUserId('user_1');

    expect(updated).toMatchObject({
      enabled: false,
      minReadyProcesses: 2,
      poolSize: 4,
    });
    expect(found).toMatchObject({
      enabled: false,
      minReadyProcesses: 2,
      poolSize: 4,
    });
  });

  it('rejects invalid pool capacity updates', async () => {
    const { pools } = await createRepositoryFixture();
    await pools.ensureForUser({
      defaults: createTestDefaults(),
      ownerUserId: 'user_1',
    });

    await expect(pools.updateByOwnerUserId('user_1', {
      minReadyProcesses: 3,
      poolSize: 2,
    })).rejects.toThrow('SRT pool minReadyProcesses must be <= poolSize.');
  });

  it('rejects overlapping proxy port ranges', async () => {
    const { pools } = await createRepositoryFixture();
    await pools.ensureForUser({
      defaults: createTestDefaults(),
      ownerUserId: 'user_1',
    });
    await pools.ensureForUser({
      defaults: createTestDefaults(),
      ownerUserId: 'user_2',
    });

    await expect(pools.updateByOwnerUserId('user_1', {
      portRangeEnd: 9_201,
      portRangeStart: 9_150,
    })).rejects.toThrow('SRT pool proxy port range overlaps another pool.');
  });

  it('rejects child port collisions before hitting the database constraint', async () => {
    const { pools } = await createRepositoryFixture();
    await pools.ensureForUser({
      defaults: createTestDefaults(),
      ownerUserId: 'user_1',
    });
    await pools.ensureForUser({
      defaults: createTestDefaults(),
      ownerUserId: 'user_2',
    });

    await expect(pools.updateByOwnerUserId('user_1', {
      port: 31_001,
    })).rejects.toThrow('SRT pool port is already used by another pool.');
  });

  it('marks one owner pool for restart without updating unrelated users', async () => {
    const { pools } = await createRepositoryFixture();
    await pools.ensureForUser({
      defaults: createTestDefaults(),
      ownerUserId: 'user_1',
    });
    await pools.ensureForUser({
      defaults: createTestDefaults(),
      ownerUserId: 'user_2',
    });

    const restartAt = new Date('2026-05-02T00:03:00.000Z');
    const restarted = await pools.requestRestart('user_1', restartAt);
    const untouched = await pools.findByOwnerUserId('user_2');

    expect(restarted?.restartRequestedAt).toEqual(restartAt);
    expect(untouched?.restartRequestedAt).toBeNull();
  });
});

async function createRepositoryFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-user-srt-pool-'));
  tempDirs.push(dir);

  const client = createDatabaseClient({
    url: `file:${join(dir, 'test.sqlite')}`,
  });
  migrateDatabase(client);

  const users = new UserRepository(client.db);
  await users.create({
    email: 'first@example.com',
    id: 'user_1',
    name: 'first',
  });
  await users.create({
    email: 'second@example.com',
    id: 'user_2',
    name: 'second',
  });

  return {
    client,
    pools: new UserSandboxRuntimePoolRepository(client.db),
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
    poolSize: 3,
    portBase: 31_000,
    portRangeWidth: 100,
    proxyPortBase: 9_100,
    sessionTimeoutMs: 600_000,
    workspaceBaseRoot: '/app/apps/sandbox-runtime/user-workspaces',
  };
}
