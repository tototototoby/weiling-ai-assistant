import {
  BotDifySyncRepository,
  BotInstanceRepository,
  GlobalDifyConfigRepository,
  UserRepository,
  WorkspaceRepository,
  createDatabaseClient,
  migrateDatabase,
} from '@weiling-ai/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  listAdminDify,
  testAdminDifyConnection,
  updateAdminDify,
} from '../dify-admin';

const clients: Array<ReturnType<typeof createDatabaseClient>> = [];

afterEach(() => {
  clients.splice(0).forEach((client) => client.close());
});

describe('Dify admin service', () => {
  it('does not expose the stored API key and lists per-bot publication state', async () => {
    const repositories = await createRepositories({ withBot: true });
    await updateAdminDify({
      payload: {
        apiBaseUrl: 'https://dify.example.com/v1',
        apiKey: 'app-secret',
        appName: 'Company KB',
        enabled: true,
      },
      repositories,
      updatedByUserId: 'user_1',
    });

    const payload = await listAdminDify(repositories);

    expect(payload.config).toMatchObject({
      apiBaseUrl: 'https://dify.example.com/v1',
      apiKeyConfigured: true,
      appName: 'Company KB',
      enabled: true,
      revision: 2,
    });
    expect(payload.applications).toEqual([
      expect.objectContaining({ botId: 'bot_1', botName: 'Bot One', syncStatus: 'pending' }),
    ]);
    expect(JSON.stringify(payload)).not.toContain('app-secret');
  });

  it('tests the parameters endpoint with a bearer key and stores success status', async () => {
    const repositories = await createRepositories();
    await updateAdminDify({
      payload: {
        apiBaseUrl: 'https://dify.example.com/v1',
        apiKey: 'app-secret',
        appName: 'Company KB',
        enabled: true,
      },
      repositories,
      updatedByUserId: 'user_1',
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));

    const payload = await testAdminDifyConnection({
      fetchImpl,
      payload: {},
      repositories,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://dify.example.com/v1/parameters',
      expect.objectContaining({
        headers: { authorization: 'Bearer app-secret' },
        method: 'GET',
      }),
    );
    expect(payload.config).toMatchObject({
      lastTestError: null,
      lastTestStatus: 'success',
    });
  });

  it('persists a failed connection status while returning a controlled gateway error', async () => {
    const repositories = await createRepositories();
    await updateAdminDify({
      payload: {
        apiBaseUrl: 'https://dify.example.com/v1',
        apiKey: 'app-secret',
        appName: 'Company KB',
        enabled: true,
      },
      repositories,
      updatedByUserId: 'user_1',
    });

    await expect(testAdminDifyConnection({
      fetchImpl: vi.fn().mockResolvedValue(new Response('{}', { status: 401 })),
      payload: {},
      repositories,
    })).rejects.toMatchObject({ code: 'DIFY_CONNECTION_FAILED', status: 502 });

    await expect(listAdminDify(repositories)).resolves.toMatchObject({
      config: {
        lastTestError: 'Dify returned HTTP 401.',
        lastTestStatus: 'error',
      },
    });
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
    botDifySyncStates: new BotDifySyncRepository(client.db),
    botInstances,
    globalDifyConfigs: new GlobalDifyConfigRepository(client.db),
  };
}
