import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateDatabase } from '../../client.js';
import {
  closeTrackedDatabaseClients,
  createTrackedDatabaseClient as createDatabaseClient,
} from './test-database-client.js';
import { botEvents } from '../../schema/bot-events.js';
import { BotEventRepository } from '../bot-event-repository.js';
import { BotInstanceRepository } from '../bot-instance-repository.js';
import { UserRepository } from '../user-repository.js';
import { WorkspaceRepository } from '../workspace-repository.js';

const tempDirs: string[] = [];

afterEach(async () => {
  closeTrackedDatabaseClients();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('BotEventRepository', () => {
  it('returns the appended event instead of re-reading the full timeline', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-db-event-append-'));
    tempDirs.push(dir);

    const client = createDatabaseClient({
      url: `file:${join(dir, 'test.sqlite')}`,
    });
    migrateDatabase(client);

    const users = new UserRepository(client.db);
    const workspaces = new WorkspaceRepository(client.db);
    const botInstances = new BotInstanceRepository(client.db);
    const botEventsRepository = new BotEventRepository(client.db);

    await users.create({
      id: 'user_1',
      email: 'zac@example.com',
      name: 'zac',
    });
    await workspaces.create({
      id: 'ws_1',
      ownerUserId: 'user_1',
      name: 'Workspace',
    });
    await botInstances.create({
      id: 'bot_1',
      ownerUserId: 'user_1',
      workspaceId: 'ws_1',
      name: 'Bot One',
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      desiredState: 'running',
      status: 'running',
    });

    const appended = await botEventsRepository.append({
      id: 'evt_1',
      botInstanceId: 'bot_1',
      type: 'process_started',
      message: 'started',
      payloadJson: {
        pid: 120,
      },
    });

    expect(appended).toMatchObject({
      id: 'evt_1',
      botInstanceId: 'bot_1',
      type: 'process_started',
      message: 'started',
      payloadJson: {
        pid: 120,
      },
    });
  });

  it('lists events incrementally by insertion-order cursor even when later ids sort earlier lexicographically', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-db-event-cursor-'));
    tempDirs.push(dir);

    const client = createDatabaseClient({
      url: `file:${join(dir, 'test.sqlite')}`,
    });
    migrateDatabase(client);

    const users = new UserRepository(client.db);
    const workspaces = new WorkspaceRepository(client.db);
    const botInstances = new BotInstanceRepository(client.db);
    await users.create({
      id: 'user_1',
      email: 'zac@example.com',
      name: 'zac',
    });
    await workspaces.create({
      id: 'ws_1',
      ownerUserId: 'user_1',
      name: 'Workspace',
    });
    await botInstances.create({
      id: 'bot_1',
      ownerUserId: 'user_1',
      workspaceId: 'ws_1',
      name: 'Bot One',
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      desiredState: 'running',
      status: 'running',
    });

    const createdAt = new Date('2026-03-30T00:00:00.000Z');

    client.db.insert(botEvents).values([
      {
        id: 'zzz_cursor',
        botInstanceId: 'bot_1',
        type: 'process_started',
        message: 'first',
        payloadJson: JSON.stringify({ order: 1 }),
        createdAt,
      },
      {
        id: 'aaa_inserted_later',
        botInstanceId: 'bot_1',
        type: 'running',
        message: 'second',
        payloadJson: JSON.stringify({ order: 2 }),
        createdAt,
      },
    ]).run();

    const cursorRepository = new BotEventRepository(client.db) as unknown as {
      listByBotInstanceIdAfterCursor(
        botInstanceId: string,
        cursor: { rowId: number } | null,
      ): Promise<Array<{ id: string; rowId: number }>>;
    };

    const allEvents = await cursorRepository.listByBotInstanceIdAfterCursor('bot_1', null);
    const afterFirst = await cursorRepository.listByBotInstanceIdAfterCursor('bot_1', {
      rowId: allEvents[0].rowId,
    });

    expect(allEvents.map((event) => event.id)).toEqual(['zzz_cursor', 'aaa_inserted_later']);
    expect(afterFirst.map((event) => event.id)).toEqual(['aaa_inserted_later']);
  });
});
