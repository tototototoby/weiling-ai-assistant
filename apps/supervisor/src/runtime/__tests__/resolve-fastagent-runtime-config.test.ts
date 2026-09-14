import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  UserLlmProfileRepository,
  UserRepository,
  migrateDatabase,
} from '@weiling-ai/db';
import {
  closeTrackedDatabaseClients,
  createTrackedDatabaseClient as createDatabaseClient,
} from './test-database-client';
import { resolveFastAgentRuntimeConfig } from '../resolve-fastagent-runtime-config';

const tempDirs: string[] = [];

afterEach(async () => {
  closeTrackedDatabaseClients();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('resolveFastAgentRuntimeConfig', () => {
  it('resolves runtime config strictly from the bound llm profile', async () => {
    const { userLlmProfiles } = await createHarness();

    await userLlmProfiles.create({
      apiKey: 'sk-user-1',
      apiType: 'openai-responses',
      baseUrl: 'https://gateway.example.com/v1',
      id: 'profile_1',
      model: 'gpt-5.5',
      name: 'Primary OpenAI',
      provider: 'openai',
      userId: 'user_1',
    });

    const runtimeConfig = await resolveFastAgentRuntimeConfig({
      botInstance: {
        id: 'bot_1',
        llmConfigId: 'profile_1',
        model: 'claude-opus-4-6',
        ownerUserId: 'user_1',
        provider: 'anthropic',
      },
      userLlmProfiles,
    });

    expect(runtimeConfig).toEqual({
      apiKey: 'sk-user-1',
      apiType: 'openai-responses',
      baseUrl: 'https://gateway.example.com/v1',
      model: 'gpt-5.5',
      provider: 'openai',
    });
  });

  it('throws a typed error when the bot does not have a bound llm profile', async () => {
    const { userLlmProfiles } = await createHarness();

    await expect(resolveFastAgentRuntimeConfig({
      botInstance: {
        id: 'bot_1',
        llmConfigId: null,
        model: 'claude-opus-4-6',
        ownerUserId: 'user_1',
        provider: 'anthropic',
      },
      userLlmProfiles,
    })).rejects.toMatchObject({
      code: 'LLM_PROFILE_REQUIRED',
    });
  });

  it('throws a typed error when the bound llm profile is missing or invalid for the owner', async () => {
    const { userLlmProfiles } = await createHarness();

    await userLlmProfiles.create({
      apiKey: 'sk-user-2',
      apiType: null,
      baseUrl: null,
      id: 'profile_2',
      model: 'gpt-5.4',
      name: 'Foreign Profile',
      provider: 'openai',
      userId: 'user_2',
    });

    await expect(resolveFastAgentRuntimeConfig({
      botInstance: {
        id: 'bot_1',
        llmConfigId: 'profile_2',
        model: 'claude-opus-4-6',
        ownerUserId: 'user_1',
        provider: 'anthropic',
      },
      userLlmProfiles,
    })).rejects.toMatchObject({
      code: 'LLM_PROFILE_INVALID',
    });
  });

  it('throws a typed error when the bound llm profile has blank required runtime fields', async () => {
    const { userLlmProfiles } = await createHarness();

    await userLlmProfiles.create({
      apiKey: '',
      apiType: null,
      baseUrl: null,
      id: 'profile_3',
      model: '',
      name: 'Broken Profile',
      provider: '',
      userId: 'user_1',
    });

    await expect(resolveFastAgentRuntimeConfig({
      botInstance: {
        id: 'bot_1',
        llmConfigId: 'profile_3',
        model: 'claude-opus-4-6',
        ownerUserId: 'user_1',
        provider: 'anthropic',
      },
      userLlmProfiles,
    })).rejects.toMatchObject({
      code: 'LLM_PROFILE_INVALID',
    });
  });
});

async function createHarness() {
  const dir = await mkdtemp(join(tmpdir(), 'weiling-supervisor-llm-profile-'));
  tempDirs.push(dir);

  const client = createDatabaseClient({
    url: `file:${join(dir, 'test.sqlite')}`,
  });
  migrateDatabase(client);

  const users = new UserRepository(client.db);
  const userLlmProfiles = new UserLlmProfileRepository(client.db);

  await users.create({
    email: 'zac@example.com',
    id: 'user_1',
    name: 'zac',
  });
  await users.create({
    email: 'other@example.com',
    id: 'user_2',
    name: 'other',
  });

  return {
    userLlmProfiles,
  };
}
