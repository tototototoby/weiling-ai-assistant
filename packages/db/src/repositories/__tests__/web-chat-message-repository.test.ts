import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseClient, migrateDatabase } from '../../client.js';
import { BotInstanceRepository } from '../bot-instance-repository.js';
import { UserRepository } from '../user-repository.js';
import { WebChatMessageRepository } from '../web-chat-message-repository.js';
import { WorkspaceRepository } from '../workspace-repository.js';

const clients: Array<ReturnType<typeof createDatabaseClient>> = [];

afterEach(() => clients.splice(0).forEach((client) => client.close()));

describe('WebChatMessageRepository', () => {
  it('creates a user message with defaults and returns the record', async () => {
    const { messages } = await createFixture();
    const createdAt = new Date('2026-08-12T02:00:00.000Z');

    const record = await messages.create({
      botInstanceId: 'bot_1',
      content: '你好',
      createdAt,
      ownerUserId: 'admin',
      requestId: 'request_1',
      role: 'user',
    });

    expect(record).toMatchObject({
      botInstanceId: 'bot_1',
      content: '你好',
      createdAt,
      id: expect.any(String),
      ownerUserId: 'admin',
      requestId: 'request_1',
      role: 'user',
      status: 'pending',
      toolEventsJson: null,
      updatedAt: createdAt,
    });
  });

  it('finds a message by request ID and returns null when missing', async () => {
    const { messages } = await createFixture();
    await messages.create({
      botInstanceId: 'bot_1',
      content: 'hello',
      requestId: 'request_1',
      role: 'user',
    });

    const found = await messages.findByRequestId('request_1');
    const missing = await messages.findByRequestId('request_missing');

    expect(found?.requestId).toBe('request_1');
    expect(missing).toBeNull();
  });

  it('rejects a duplicate request ID with the unique index', async () => {
    const { messages } = await createFixture();
    await messages.create({
      botInstanceId: 'bot_1',
      content: 'hello',
      requestId: 'request_1',
      role: 'user',
    });

    await expect(messages.create({
      botInstanceId: 'bot_1',
      content: 'hello again',
      requestId: 'request_1',
      role: 'user',
    })).rejects.toThrow('UNIQUE constraint failed');
  });

  it('lists the most recent messages in chronological order', async () => {
    const { messages } = await createFixture();
    const base = new Date('2026-08-12T02:00:00.000Z');

    for (let index = 1; index <= 3; index += 1) {
      await messages.create({
        botInstanceId: 'bot_1',
        content: `message-${index}`,
        createdAt: new Date(base.getTime() + index),
        role: 'user',
      });
    }

    const history = await messages.listByBotInstanceId('bot_1');
    expect(history.map((record) => record.content)).toEqual([
      'message-1',
      'message-2',
      'message-3',
    ]);
  });

  it('marks a pending message as streaming and then stores the final result', async () => {
    const { messages } = await createFixture();
    const record = await messages.create({
      botInstanceId: 'bot_1',
      content: '',
      requestId: 'request_1',
      role: 'assistant',
    });

    await messages.markStreaming(record.id);
    const streaming = await messages.findByRequestId('request_1');
    expect(streaming?.status).toBe('streaming');

    const toolEvents = JSON.stringify([{ kind: 'tool_call', name: 'dify' }]);
    await messages.markResult(record.id, {
      content: 'final reply',
      status: 'succeeded',
      toolEventsJson: toolEvents,
    });

    const completed = await messages.findByRequestId('request_1');
    expect(completed).toMatchObject({
      content: 'final reply',
      status: 'succeeded',
      toolEventsJson: toolEvents,
    });
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
  await botInstances.create({
    desiredState: 'running',
    id: 'bot_1',
    model: 'test-model',
    name: 'Bot 1',
    ownerUserId: 'admin',
    provider: 'test-provider',
    status: 'running',
    workspaceId: 'workspace_1',
  });

  return {
    client,
    messages: new WebChatMessageRepository(client.db),
  };
}
