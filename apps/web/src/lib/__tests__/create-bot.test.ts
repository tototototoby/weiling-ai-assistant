import { access, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  BotEventRepository,
  BotInstanceRepository,
  UserLlmProfileRepository,
  UserRepository,
  WorkspaceRepository,
  createDatabaseClient,
  migrateDatabase,
  type DatabaseClient,
} from '@weiling-ai/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const randomUUIDMock = vi.hoisted(() => vi.fn());
const testState = vi.hoisted(() => ({
  client: null as DatabaseClient | null,
  instancesRoot: '',
  userBotLimit: null as number | null,
  repositories: null as {
    botEvents: BotEventRepository;
    botInstances: BotInstanceRepository;
    userLlmProfiles: UserLlmProfileRepository;
    users: UserRepository;
    workspaces: WorkspaceRepository;
  } | null,
}));

vi.mock('node:crypto', () => ({
  randomUUID: randomUUIDMock,
}));

vi.mock('../repositories', () => ({
  getDatabaseClient: () => {
    if (!testState.client) {
      throw new Error('Database client test state not initialized.');
    }

    return testState.client;
  },
  getRepositories: () => {
    if (!testState.repositories) {
      throw new Error('Repositories test state not initialized.');
    }

    return testState.repositories;
  },
}));

vi.mock('../env', async () => {
  const actual = await vi.importActual<typeof import('../env')>('../env');

  return {
    ...actual,
    getUserBotLimit: () => testState.userBotLimit,
    resolveInstancesRoot: () => testState.instancesRoot,
  };
});

const tempDirs: string[] = [];

beforeEach(async () => {
  vi.resetModules();
  randomUUIDMock.mockReset();

  const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-create-bot-'));
  tempDirs.push(dir);

  const client = createDatabaseClient({
    url: `file:${join(dir, 'test.sqlite')}`,
  });
  migrateDatabase(client);

  const users = new UserRepository(client.db);
  const workspaces = new WorkspaceRepository(client.db);
  const botInstances = new BotInstanceRepository(client.db);
  const botEvents = new BotEventRepository(client.db);
  const userLlmProfiles = new UserLlmProfileRepository(client.db);

  await users.create({
    id: 'user_1',
    email: 'zac@example.com',
    name: 'zac',
  });
  await users.create({
    id: 'user_2',
    email: 'amy@example.com',
    name: 'amy',
  });
  await userLlmProfiles.create({
    apiKey: 'sk-user-1',
    apiType: 'openai-responses',
    baseUrl: 'https://gateway.example.com/v1',
    id: 'profile_1',
    model: 'gpt-5.4',
    name: 'Primary',
    provider: 'openai',
    userId: 'user_1',
  });

  testState.client = client;
  testState.instancesRoot = join(dir, 'instances');
  testState.userBotLimit = null;
  testState.repositories = {
    botEvents,
    botInstances,
    userLlmProfiles,
    users,
    workspaces,
  };
});

afterEach(async () => {
  testState.client?.close();
  testState.client = null;
  testState.repositories = null;
  testState.instancesRoot = '';
  testState.userBotLimit = null;

  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('createBot', () => {
  it('creates the expected directories using the selected llm profile and stores the binding', async () => {
    randomUUIDMock
      .mockReturnValueOnce('bot_1')
      .mockReturnValueOnce('ws_1');

    const { createBot } = await import('../bot-service');
    const bot = await createBot({
      llmProfileId: 'profile_1',
      ownerUserId: 'user_1',
      name: 'Bot One',
    });

    const storedBot = await testState.repositories?.botInstances.findById('bot_1');

    expect(bot).toMatchObject({
      id: 'bot_1',
      desiredState: 'running',
      model: 'gpt-5.4',
      provider: 'openai',
      llmConfigId: 'profile_1',
      status: 'provisioning',
    });
    expect(storedBot).toMatchObject({
      id: 'bot_1',
      llmConfigId: 'profile_1',
      model: 'gpt-5.4',
      provider: 'openai',
      workspaceId: 'ws_1',
    });

    await expect(access(join(testState.instancesRoot, 'bot_1', 'data'))).resolves.toBeUndefined();
    await expect(access(join(testState.instancesRoot, 'bot_1', 'workspace'))).resolves.toBeUndefined();
    await expect(access(join(testState.instancesRoot, 'bot_1', 'logs'))).resolves.toBeUndefined();
  });

  it('rejects bot creation when the selected llm profile does not belong to the owner', async () => {
    const { createBot } = await import('../bot-service');

    await expect(createBot({
      llmProfileId: 'profile_missing',
      ownerUserId: 'user_1',
      name: 'Bot Missing Profile',
    })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'LLM profile not found.',
      status: 404,
    });
  });

  it('rejects bot creation when the user has reached the configured bot limit', async () => {
    testState.userBotLimit = 1;

    await testState.repositories?.workspaces.create({
      id: 'ws_existing',
      ownerUserId: 'user_1',
      name: 'Existing Workspace',
    });
    await testState.repositories?.botInstances.create({
      id: 'bot_existing',
      ownerUserId: 'user_1',
      workspaceId: 'ws_existing',
      name: 'Existing Bot',
      provider: 'openai',
      model: 'gpt-5.4',
      desiredState: 'running',
      status: 'running',
    });

    const { createBot } = await import('../bot-service');

    await expect(createBot({
      llmProfileId: 'profile_1',
      ownerUserId: 'user_1',
      name: 'Second Bot',
    })).rejects.toMatchObject({
      code: 'BOT_LIMIT_REACHED',
      message: 'You have reached the bot limit for this account.',
      status: 409,
    });
  });

  it('enforces the configured bot limit atomically across concurrent create requests', async () => {
    testState.userBotLimit = 1;
    randomUUIDMock
      .mockReturnValueOnce('bot_1')
      .mockReturnValueOnce('ws_1')
      .mockReturnValueOnce('bot_2')
      .mockReturnValueOnce('ws_2');

    const { createBot } = await import('../bot-service');
    const results = await Promise.allSettled([
      createBot({
        llmProfileId: 'profile_1',
        ownerUserId: 'user_1',
        name: 'Bot One',
      }),
      createBot({
        llmProfileId: 'profile_1',
        ownerUserId: 'user_1',
        name: 'Bot Two',
      }),
    ]);

    const fulfilledResults = results.filter((result) => result.status === 'fulfilled');
    const rejectedResults = results.filter((result) => result.status === 'rejected');
    const storedBots = await testState.repositories?.botInstances.listByOwnerUserId('user_1');

    expect(fulfilledResults).toHaveLength(1);
    expect(rejectedResults).toHaveLength(1);
    expect(rejectedResults[0]).toMatchObject({
      reason: {
        code: 'BOT_LIMIT_REACHED',
        message: 'You have reached the bot limit for this account.',
        status: 409,
      },
    });
    expect(storedBots).toHaveLength(1);
  });

  it('rolls back database writes and cleans directories when the bot row insert fails', async () => {
    await testState.repositories?.workspaces.create({
      id: 'ws_existing',
      ownerUserId: 'user_1',
      name: 'Existing Workspace',
    });
    await testState.repositories?.botInstances.create({
      id: 'bot_duplicate',
      ownerUserId: 'user_1',
      workspaceId: 'ws_existing',
      name: 'Existing Bot',
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      desiredState: 'running',
      status: 'running',
    });

    randomUUIDMock
      .mockReturnValueOnce('bot_duplicate')
      .mockReturnValueOnce('ws_failed');

    const { createBot } = await import('../bot-service');

    await expect(createBot({
      llmProfileId: 'profile_1',
      ownerUserId: 'user_1',
      name: 'Broken Bot',
    })).rejects.toThrow();

    expect(await testState.repositories?.workspaces.findById('ws_failed')).toBeNull();
    await expect(access(join(testState.instancesRoot, 'bot_duplicate'))).rejects.toThrow();
  });
});
