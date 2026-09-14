import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  BotInstanceRepository,
  BotSandboxRuntimePoolRepository,
  UserRepository,
  WorkspaceRepository,
  createDatabaseClient,
  migrateDatabase,
  type DatabaseClient,
} from '@weiling-ai/db';
import { parseSandboxRuntimePoolDefaults } from '@weiling-ai/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ensureBotSandboxRuntimePool,
  renderAllSandboxRuntimePools,
} from '../srt-pool-provisioning';

const tempDirs: string[] = [];
const databaseClients: DatabaseClient[] = [];

afterEach(async () => {
  databaseClients.splice(0).forEach((client) => client.close());
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('srt-pool-provisioning', () => {
  it('ensures a pool and renders all DB rows to the private config file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-srt-provisioning-'));
    tempDirs.push(dir);

    const client = createDatabaseClient({
      url: `file:${join(dir, 'test.sqlite')}`,
    });
    databaseClients.push(client);
    migrateDatabase(client);

    const users = new UserRepository(client.db);
    const workspaces = new WorkspaceRepository(client.db);
    const bots = new BotInstanceRepository(client.db);
    const pools = new BotSandboxRuntimePoolRepository(client.db);
    await users.create({
      email: 'owner@example.com',
      id: 'user_1',
      name: 'owner',
    });
    await workspaces.create({ id: 'ws_1', name: 'Workspace', ownerUserId: 'user_1' });
    await bots.create({
      desiredState: 'running',
      id: 'bot_1',
      model: 'test-model',
      name: 'Bot One',
      ownerUserId: 'user_1',
      provider: 'test-provider',
      status: 'provisioning',
      workspaceId: 'ws_1',
    });

    await ensureBotSandboxRuntimePool({
      botInstanceId: 'bot_1',
      defaults: parseSandboxRuntimePoolDefaults({}),
      repository: pools,
    });
    await renderAllSandboxRuntimePools({
      filePath: join(dir, 'private', 'srt-pools.json'),
      now: new Date('2026-05-02T00:00:00.000Z'),
      repository: pools,
      serviceHost: 'sandbox-runtime',
      workspaceMapDir: join(dir, 'private', 'workspace-map'),
    });

    const document = JSON.parse(await readFile(join(dir, 'private', 'srt-pools.json'), 'utf8')) as {
      pools: Array<{ botInstanceId: string; url: string }>;
    };

    expect(document.pools).toHaveLength(1);
    expect(document.pools[0]).toMatchObject({
      botInstanceId: 'bot_1',
      url: 'http://sandbox-runtime:31000',
    });
  });
});
