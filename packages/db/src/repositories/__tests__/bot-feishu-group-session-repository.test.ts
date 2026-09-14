import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseClient, migrateDatabase } from '../../client.js';
import { botFeishuGroupSessions } from '../../schema/bot-feishu-group-sessions.js';
import { BotFeishuGroupSessionRepository } from '../bot-feishu-group-session-repository.js';
import { BotInstanceRepository } from '../bot-instance-repository.js';
import { UserRepository } from '../user-repository.js';
import { WorkspaceRepository } from '../workspace-repository.js';

const clients: Array<ReturnType<typeof createDatabaseClient>> = [];

afterEach(() => clients.splice(0).forEach((client) => client.close()));

describe('BotFeishuGroupSessionRepository', () => {
  it('stores and returns the per-Bot group session mapping', async () => {
    const { client, sessions } = await createFixture();
    const createdAt = new Date('2026-09-01T04:00:00.000Z');

    await expect(sessions.find('bot_1', 'oc_group')).resolves.toBeNull();
    await sessions.upsert('bot_1', 'oc_group', 'session-a', createdAt);
    await expect(sessions.find('bot_1', 'oc_group')).resolves.toEqual({
      sessionId: 'session-a',
    });

    await sessions.upsert('bot_1', 'oc_group', 'session-b', new Date('2026-09-01T05:00:00.000Z'));
    await expect(sessions.find('bot_1', 'oc_group')).resolves.toEqual({
      sessionId: 'session-b',
    });
    await expect(sessions.find('bot_1', 'oc_other')).resolves.toBeNull();
    await expect(sessions.find('bot_2', 'oc_group')).resolves.toBeNull();
    expect(client.db.select().from(botFeishuGroupSessions).all()).toHaveLength(1);
  });
});

async function createFixture() {
  const client = createDatabaseClient({ url: ':memory:' });
  clients.push(client);
  migrateDatabase(client);

  const users = new UserRepository(client.db);
  const workspaces = new WorkspaceRepository(client.db);
  const botInstances = new BotInstanceRepository(client.db);
  await users.create({ email: 'admin@example.com', id: 'admin', name: 'Admin' });
  await workspaces.create({ id: 'workspace_1', name: 'Workspace', ownerUserId: 'admin' });
  for (const id of ['bot_1', 'bot_2']) {
    await botInstances.create({
      desiredState: 'running',
      id,
      model: 'test-model',
      name: id,
      ownerUserId: 'admin',
      provider: 'test-provider',
      status: 'running',
      workspaceId: 'workspace_1',
    });
  }

  return {
    client,
    sessions: new BotFeishuGroupSessionRepository(client.db),
  };
}
