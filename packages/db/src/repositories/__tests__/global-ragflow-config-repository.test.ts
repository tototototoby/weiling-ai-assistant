import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseClient, migrateDatabase } from '../../client.js';
import { BotInstanceRepository } from '../bot-instance-repository.js';
import { BotRagflowSyncRepository } from '../bot-ragflow-sync-repository.js';
import { GlobalRagflowConfigRepository } from '../global-ragflow-config-repository.js';
import { UserRepository } from '../user-repository.js';
import { WorkspaceRepository } from '../workspace-repository.js';

const clients: Array<ReturnType<typeof createDatabaseClient>> = [];

afterEach(() => {
  clients.splice(0).forEach((client) => client.close());
});

describe('GlobalRagflowConfigRepository', () => {
  it('normalizes datasets, preserves a blank replacement key, and advances revision only on change', async () => {
    const { configs } = await createFixture();
    const createdAt = new Date('2026-07-23T08:00:00.000Z');
    const updatedAt = new Date('2026-07-23T08:01:00.000Z');
    await configs.ensure(createdAt);

    const enabled = await configs.update({
      apiBaseUrl: 'https://ragflow.example.com/api/v1/',
      apiKey: 'ragflow-secret',
      datasetIds: ['dataset_b', 'dataset_a', 'dataset_a', '  '],
      enabled: true,
      knowledgeBaseName: ' Company RAG ',
      updatedAt,
      updatedByUserId: 'user_1',
    });
    const unchanged = await configs.update({
      apiBaseUrl: 'https://ragflow.example.com/api/v1',
      apiKey: '   ',
      datasetIds: ['dataset_a', 'dataset_b'],
      enabled: true,
      knowledgeBaseName: 'Company RAG',
      updatedByUserId: 'user_1',
    });

    expect(enabled).toMatchObject({
      apiBaseUrl: 'https://ragflow.example.com/api/v1',
      apiKey: 'ragflow-secret',
      datasetIds: ['dataset_a', 'dataset_b'],
      enabled: true,
      knowledgeBaseName: 'Company RAG',
      revision: 2,
      updatedAt,
    });
    expect(unchanged).toEqual(enabled);
  });

  it('marks every materialized Bot projection pending when configuration changes', async () => {
    const { configs, syncStates } = await createFixture({ withBot: true });
    await configs.ensure();
    await syncStates.ensureForAllBots();
    await syncStates.markSyncSucceeded('bot_1', 1);

    await configs.update({
      apiBaseUrl: 'https://ragflow.example.com/api/v1',
      apiKey: 'ragflow-secret',
      datasetIds: ['dataset_1'],
      enabled: true,
      knowledgeBaseName: 'Company RAG',
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

  it('requires a complete enabled configuration and records tests without changing revision', async () => {
    const { configs } = await createFixture();
    await configs.ensure();

    await expect(configs.update({
      apiBaseUrl: 'https://ragflow.example.com/api/v1',
      datasetIds: ['dataset_1'],
      enabled: true,
      knowledgeBaseName: 'Company RAG',
      updatedByUserId: 'user_1',
    })).rejects.toThrow('RAGFlow API key is required');

    await expect(configs.update({
      apiBaseUrl: 'https://ragflow.example.com/api/v1',
      apiKey: 'ragflow-secret',
      datasetIds: [],
      enabled: true,
      knowledgeBaseName: 'Company RAG',
      updatedByUserId: 'user_1',
    })).rejects.toThrow('At least one RAGFlow dataset ID is required');

    const testedAt = new Date('2026-07-23T08:02:00.000Z');
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

describe('BotRagflowSyncRepository', () => {
  it('rejects an applied revision newer than the global RAGFlow revision', async () => {
    const { configs, syncStates } = await createFixture({ withBot: true });
    await configs.ensure();
    await syncStates.ensureForAllBots();

    await expect(syncStates.markSyncSucceeded('bot_1', 2))
      .rejects.toThrow('Applied RAGFlow revision cannot exceed the global revision.');
  });

  it('removes Bot projection state when its workspace is deleted', async () => {
    const { configs, syncStates, workspaces } = await createFixture({ withBot: true });
    await configs.ensure();
    await syncStates.ensureForAllBots();

    await workspaces.deleteById('ws_1');

    await expect(syncStates.listAll()).resolves.toEqual([]);
  });
});

async function createFixture(input: { withBot?: boolean } = {}) {
  const client = createDatabaseClient({ url: ':memory:' });
  clients.push(client);
  migrateDatabase(client);

  const users = new UserRepository(client.db);
  const workspaces = new WorkspaceRepository(client.db);
  await users.create({ email: 'admin@example.com', id: 'user_1', name: 'Admin' });

  if (input.withBot) {
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
    configs: new GlobalRagflowConfigRepository(client.db),
    syncStates: new BotRagflowSyncRepository(client.db),
    workspaces,
  };
}
