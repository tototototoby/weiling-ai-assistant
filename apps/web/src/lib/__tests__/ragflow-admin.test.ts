import {
  BotInstanceRepository,
  BotRagflowSyncRepository,
  GlobalRagflowConfigRepository,
  UserRepository,
  WorkspaceRepository,
  createDatabaseClient,
  migrateDatabase,
} from '@weiling-ai/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  listAdminRagflow,
  testAdminRagflowConnection,
  updateAdminRagflow,
} from '../ragflow-admin';

const clients: Array<ReturnType<typeof createDatabaseClient>> = [];

afterEach(() => {
  clients.splice(0).forEach((client) => client.close());
});

describe('RAGFlow admin service', () => {
  it('does not expose the stored API key and lists per-bot sync state', async () => {
    const repositories = await createRepositories({ withBot: true });
    await updateAdminRagflow({
      payload: {
        apiBaseUrl: 'https://ragflow.example.com/api/v1',
        apiKey: 'ragflow-secret',
        datasetIds: ['dataset_b', 'dataset_a'],
        enabled: true,
        knowledgeBaseName: 'Company RAG',
      },
      repositories,
      updatedByUserId: 'user_1',
    });

    const payload = await listAdminRagflow(repositories);

    expect(payload.config).toMatchObject({
      apiBaseUrl: 'https://ragflow.example.com/api/v1',
      apiKeyConfigured: true,
      datasetIds: ['dataset_a', 'dataset_b'],
      enabled: true,
      knowledgeBaseName: 'Company RAG',
      revision: 2,
    });
    expect(payload.applications).toEqual([
      expect.objectContaining({ botId: 'bot_1', botName: 'Bot One', syncStatus: 'pending' }),
    ]);
    expect(JSON.stringify(payload)).not.toContain('ragflow-secret');
  });

  it('tests the datasets endpoint with a bearer key and configured dataset id', async () => {
    const repositories = await createRepositories();
    await updateAdminRagflow({
      payload: {
        apiBaseUrl: 'https://ragflow.example.com/api/v1',
        apiKey: 'ragflow-secret',
        datasetIds: ['dataset_1'],
        enabled: true,
        knowledgeBaseName: 'Company RAG',
      },
      repositories,
      updatedByUserId: 'user_1',
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: [] }), { status: 200 }));

    const payload = await testAdminRagflowConnection({
      fetchImpl,
      payload: {},
      repositories,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://ragflow.example.com/api/v1/datasets?id=dataset_1&page=1&page_size=1',
      expect.objectContaining({
        headers: { authorization: 'Bearer ragflow-secret' },
        method: 'GET',
      }),
    );
    expect(payload.config).toMatchObject({
      lastTestError: null,
      lastTestStatus: 'success',
    });
  });

  it('adds the RAGFlow API prefix when the configured URL is the server root', async () => {
    const repositories = await createRepositories();
    await updateAdminRagflow({
      payload: {
        apiBaseUrl: 'https://ragflow.example.com',
        apiKey: 'ragflow-secret',
        datasetIds: ['dataset_1'],
        enabled: true,
        knowledgeBaseName: 'Company RAG',
      },
      repositories,
      updatedByUserId: 'user_1',
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: [] }), { status: 200 }));

    await testAdminRagflowConnection({
      fetchImpl,
      payload: {},
      repositories,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://ragflow.example.com/api/v1/datasets?id=dataset_1&page=1&page_size=1',
      expect.any(Object),
    );
  });

  it('persists a failed connection status while returning a controlled gateway error', async () => {
    const repositories = await createRepositories();
    await updateAdminRagflow({
      payload: {
        apiBaseUrl: 'https://ragflow.example.com/api/v1',
        apiKey: 'ragflow-secret',
        datasetIds: ['dataset_1'],
        enabled: true,
        knowledgeBaseName: 'Company RAG',
      },
      repositories,
      updatedByUserId: 'user_1',
    });

    await expect(testAdminRagflowConnection({
      fetchImpl: vi.fn().mockResolvedValue(new Response('{}', { status: 401 })),
      payload: {},
      repositories,
    })).rejects.toMatchObject({ code: 'RAGFLOW_CONNECTION_FAILED', status: 502 });

    await expect(listAdminRagflow(repositories)).resolves.toMatchObject({
      config: {
        lastTestError: 'RAGFlow returned HTTP 401.',
        lastTestStatus: 'error',
      },
    });
  });

  it('requires a fresh API key when testing a different host', async () => {
    const repositories = await createRepositories();
    await updateAdminRagflow({
      payload: {
        apiBaseUrl: 'https://ragflow.example.com/api/v1',
        apiKey: 'ragflow-secret',
        datasetIds: ['dataset_1'],
        enabled: true,
        knowledgeBaseName: 'Company RAG',
      },
      repositories,
      updatedByUserId: 'user_1',
    });

    const fetchImpl = vi.fn();
    await expect(testAdminRagflowConnection({
      fetchImpl,
      payload: { apiBaseUrl: 'https://other-ragflow.example.com/api/v1' },
      repositories,
    })).rejects.toMatchObject({ code: 'RAGFLOW_INVALID_CONFIG', status: 400 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects an empty successful response body', async () => {
    const repositories = await createRepositories();
    await updateAdminRagflow({
      payload: {
        apiBaseUrl: 'https://ragflow.example.com/api/v1',
        apiKey: 'ragflow-secret',
        datasetIds: ['dataset_1'],
        enabled: true,
        knowledgeBaseName: 'Company RAG',
      },
      repositories,
      updatedByUserId: 'user_1',
    });

    await expect(testAdminRagflowConnection({
      fetchImpl: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
      payload: {},
      repositories,
    })).rejects.toMatchObject({ code: 'RAGFLOW_CONNECTION_FAILED', status: 502 });
  });
});

async function createRepositories(input: { withBot?: boolean } = {}) {
  const client = createDatabaseClient({ url: ':memory:' });
  clients.push(client);
  migrateDatabase(client);
  const users = new UserRepository(client.db);
  const workspaces = new WorkspaceRepository(client.db);
  const botInstances = new BotInstanceRepository(client.db);
  await users.create({ email: 'admin@example.com', id: 'user_1', name: 'Admin' });

  if (input.withBot) {
    await workspaces.create({ id: 'ws_1', name: 'One', ownerUserId: 'user_1' });
    await botInstances.create({
      desiredState: 'running',
      id: 'bot_1',
      model: 'test',
      name: 'Bot One',
      ownerUserId: 'user_1',
      provider: 'openai',
      status: 'running',
      workspaceId: 'ws_1',
    });
  }

  return {
    botInstances,
    botRagflowSyncStates: new BotRagflowSyncRepository(client.db),
    globalRagflowConfigs: new GlobalRagflowConfigRepository(client.db),
  };
}
