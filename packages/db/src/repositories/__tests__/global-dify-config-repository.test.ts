import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseClient, migrateDatabase } from '../../client.js';
import { BotDifySyncRepository } from '../bot-dify-sync-repository.js';
import { BotInstanceRepository } from '../bot-instance-repository.js';
import { GlobalDifyConfigRepository } from '../global-dify-config-repository.js';
import { UserRepository } from '../user-repository.js';
import { WorkspaceRepository } from '../workspace-repository.js';

const clients: Array<ReturnType<typeof createDatabaseClient>> = [];

afterEach(() => {
  clients.splice(0).forEach((client) => client.close());
});

describe('GlobalDifyConfigRepository', () => {
  it('stores one global config, preserves a blank replacement key, and advances revision only on change', async () => {
    const { configs } = await createFixture();
    const createdAt = new Date('2026-07-23T01:00:00.000Z');
    const updatedAt = new Date('2026-07-23T01:01:00.000Z');
    await configs.ensure(createdAt);

    const enabled = await configs.update({
      apiBaseUrl: 'https://dify.example.com/v1/',
      apiKey: 'app-secret',
      appName: ' Company KB ',
      enabled: true,
      updatedAt,
      updatedByUserId: 'user_1',
    });
    const unchanged = await configs.update({
      apiBaseUrl: 'https://dify.example.com/v1',
      apiKey: '   ',
      appName: 'Company KB',
      enabled: true,
      updatedByUserId: 'user_1',
    });

    expect(enabled).toMatchObject({
      apiBaseUrl: 'https://dify.example.com/v1',
      apiKey: 'app-secret',
      appName: 'Company KB',
      enabled: true,
      revision: 2,
      updatedAt,
    });
    expect(unchanged).toEqual(enabled);
  });

  it('marks every materialized bot projection pending when configuration changes', async () => {
    const { configs, syncStates } = await createFixture({ withBot: true });
    await configs.ensure();
    await syncStates.ensureForAllBots();
    await syncStates.markSyncSucceeded('bot_1', 1);

    await configs.update({
      apiBaseUrl: 'https://dify.example.com/v1',
      apiKey: 'app-secret',
      appName: 'Company KB',
      enabled: true,
      updatedByUserId: 'user_1',
    });

    await expect(syncStates.listAll()).resolves.toEqual([
      expect.objectContaining({
        appliedRevision: 1,
        botInstanceId: 'bot_1',
        lastSyncError: null,
        syncStatus: 'pending',
      }),
    ]);
  });

  it('requires a complete enabled configuration and records connection tests without changing revision', async () => {
    const { configs } = await createFixture();
    await configs.ensure();

    await expect(configs.update({
      apiBaseUrl: 'https://dify.example.com/v1',
      appName: 'Company KB',
      enabled: true,
      updatedByUserId: 'user_1',
    })).rejects.toThrow('Dify API key is required');

    const testedAt = new Date('2026-07-23T01:02:00.000Z');
    const tested = await configs.recordTestResult({
      error: 'Unauthorized',
      status: 'error',
      testedAt,
    });

    expect(tested).toMatchObject({
      lastTestError: 'Unauthorized',
      lastTestStatus: 'error',
      lastTestedAt: testedAt,
      revision: 1,
    });
  });
});

describe('BotDifySyncRepository', () => {
  it('rejects an applied revision newer than the global Dify revision', async () => {
    const { configs, syncStates } = await createFixture({ withBot: true });
    await configs.ensure();
    await syncStates.ensureForAllBots();

    await expect(syncStates.markSyncSucceeded('bot_1', 2))
      .rejects.toThrow('Applied Dify revision cannot exceed the global revision.');
  });
});

async function createFixture(input: { withBot?: boolean } = {}) {
  const client = createDatabaseClient({ url: ':memory:' });
  clients.push(client);
  migrateDatabase(client);

  const users = new UserRepository(client.db);
  await users.create({ email: 'admin@example.com', id: 'user_1', name: 'Admin' });

  if (input.withBot) {
    const workspaces = new WorkspaceRepository(client.db);
    const bots = new BotInstanceRepository(client.db);
    await workspaces.create({ id: 'ws_1', name: 'One', ownerUserId: 'user_1' });
    await bots.create({
      desiredState: 'running',
      id: 'bot_1',
      model: 'test',
      name: 'One',
      ownerUserId: 'user_1',
      provider: 'openai',
      status: 'stopped',
      workspaceId: 'ws_1',
    });
  }

  return {
    configs: new GlobalDifyConfigRepository(client.db),
    syncStates: new BotDifySyncRepository(client.db),
  };
}
