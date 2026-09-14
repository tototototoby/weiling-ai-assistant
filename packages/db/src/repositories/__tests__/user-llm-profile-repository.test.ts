import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateDatabase } from '../../client.js';
import {
  closeTrackedDatabaseClients,
  createTrackedDatabaseClient as createDatabaseClient,
} from './test-database-client.js';
import { UserLlmProfileRepository } from '../user-llm-profile-repository.js';
import { UserRepository } from '../user-repository.js';

const tempDirs: string[] = [];

afterEach(async () => {
  closeTrackedDatabaseClients();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('UserLlmProfileRepository', () => {
  it('creates, lists, updates, and deletes owner-scoped llm profiles', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-user-llm-profile-'));
    tempDirs.push(dir);

    const client = createDatabaseClient({
      url: `file:${join(dir, 'test.sqlite')}`,
    });
    migrateDatabase(client);

    const users = new UserRepository(client.db);
    const userLlmProfiles = new UserLlmProfileRepository(client.db);

    await users.create({
      id: 'user_1',
      email: 'zac@example.com',
      name: 'zac',
    });

    const created = await userLlmProfiles.create({
      id: 'profile_1',
      userId: 'user_1',
      name: 'Primary Anthropic',
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      apiKey: 'sk-ant-1',
      baseUrl: null,
      apiType: null,
    });
    const listed = await userLlmProfiles.listByUserId('user_1');
    const found = await userLlmProfiles.findByIdForUser('profile_1', 'user_1');
    const updated = await userLlmProfiles.updateByIdForUser('profile_1', 'user_1', {
      name: 'Primary OpenAI',
      provider: 'openai',
      model: 'gpt-5.4',
      apiKey: 'sk-openai-1',
      baseUrl: 'https://api.openai.com/v1',
      apiType: 'openai-responses',
      updatedAt: new Date('2026-04-17T00:00:00.000Z'),
    });
    const deleted = await userLlmProfiles.deleteByIdForUser('profile_1', 'user_1');
    const missing = await userLlmProfiles.findByIdForUser('profile_1', 'user_1');

    expect(created).toMatchObject({
      id: 'profile_1',
      name: 'Primary Anthropic',
      userId: 'user_1',
    });
    expect(listed).toHaveLength(1);
    expect(found).toMatchObject({
      id: 'profile_1',
      name: 'Primary Anthropic',
    });
    expect(updated).toMatchObject({
      id: 'profile_1',
      name: 'Primary OpenAI',
      provider: 'openai',
      model: 'gpt-5.4',
      apiType: 'openai-responses',
    });
    expect(deleted).toMatchObject({
      id: 'profile_1',
    });
    expect(missing).toBeNull();
  });
});
