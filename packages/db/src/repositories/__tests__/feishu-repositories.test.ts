import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseClient, migrateDatabase } from '../../client.js';
import { botFeishuEvents } from '../../schema/bot-feishu-events.js';
import { BotFeishuConfigRepository } from '../bot-feishu-config-repository.js';
import { BotFeishuEventRepository } from '../bot-feishu-event-repository.js';
import { BotInstanceRepository } from '../bot-instance-repository.js';
import { UserRepository } from '../user-repository.js';
import { WorkspaceRepository } from '../workspace-repository.js';

const clients: Array<ReturnType<typeof createDatabaseClient>> = [];

afterEach(() => clients.splice(0).forEach((client) => client.close()));

describe('BotFeishuConfigRepository', () => {
  it('ensures a default per-Bot config and preserves its creation time', async () => {
    const { configs } = await createFixture();
    const createdAt = new Date('2026-08-31T01:00:00.000Z');

    await expect(configs.findByBotInstanceId('bot_1')).resolves.toBeNull();
    const created = await configs.ensure('bot_1', createdAt);
    const ensuredAgain = await configs.ensure('bot_1', new Date('2026-08-31T02:00:00.000Z'));

    expect(created).toMatchObject({
      appId: '',
      appSecret: '',
      botInstanceId: 'bot_1',
      createdAt,
      enabled: false,
      eventStatus: 'not_configured',
      revision: 1,
      updatedAt: createdAt,
    });
    expect(ensuredAgain).toEqual(created);
  });

  it('normalizes updates, preserves an omitted secret, and advances revision only on change', async () => {
    const { configs } = await createFixture();
    await configs.ensure('bot_1', new Date('2026-08-31T01:00:00.000Z'));
    const updatedAt = new Date('2026-08-31T01:05:00.000Z');

    const enabled = await configs.update({
      appId: ' cli_app-one ',
      appSecret: ' secret-one ',
      botInstanceId: ' bot_1 ',
      enabled: true,
      updatedAt,
      updatedByUserId: 'admin',
    });
    const unchanged = await configs.update({
      appId: 'cli_app-one',
      appSecret: '   ',
      botInstanceId: 'bot_1',
      enabled: true,
      updatedByUserId: 'admin',
    });

    expect(enabled).toMatchObject({
      appId: 'cli_app-one',
      appSecret: 'secret-one',
      botInstanceId: 'bot_1',
      enabled: true,
      eventStatus: 'connecting',
      observedRevision: null,
      revision: 2,
      updatedAt,
      updatedByUserId: 'admin',
    });
    expect(unchanged).toEqual(enabled);
  });

  it('requires an App ID when enabled and lists only configured Bots', async () => {
    const { configs } = await createFixture({ bots: 2 });
    await configs.ensure('bot_1');
    await configs.ensure('bot_2');

    await expect(configs.update({
      appId: '   ',
      botInstanceId: 'bot_1',
      enabled: true,
    })).rejects.toThrow('Feishu App ID is required');
    await expect(configs.listConfigured()).resolves.toEqual([]);
    await expect(configs.update({
      appId: 'cli_app-one',
      botInstanceId: 'bot_1',
      enabled: true,
    })).resolves.toMatchObject({
      appId: 'cli_app-one',
      appSecret: '',
      enabled: true,
      eventStatus: 'connecting',
    });

    const configured = await configs.listConfigured();
    expect(configured.map((config) => config.botInstanceId)).toEqual(['bot_1']);
  });

  it('records connection state only for the current revision and sanitizes blank errors', async () => {
    const { configs } = await createFixture();
    await configs.ensure('bot_1');
    const enabled = await configs.update({
      appId: 'cli_app-one',
      appSecret: 'secret',
      botInstanceId: 'bot_1',
      enabled: true,
    });
    const connectedAt = new Date('2026-08-31T01:10:00.000Z');
    const connected = await configs.recordEventStatus({
      botInstanceId: 'bot_1',
      connectedAt,
      error: '   ',
      observedRevision: enabled.revision,
      status: 'connected',
      updatedAt: connectedAt,
    });
    const stale = await configs.recordEventStatus({
      botInstanceId: 'bot_1',
      error: 'stale failure',
      observedRevision: enabled.revision - 1,
      status: 'error',
    });

    expect(connected).toMatchObject({
      eventStatus: 'connected',
      lastConnectedAt: connectedAt,
      lastError: null,
      observedRevision: enabled.revision,
      revision: enabled.revision,
    });
    expect(stale).toEqual(connected);
  });

  it('disables and clears credentials, and records activity timestamps', async () => {
    const { configs } = await createFixture();
    await configs.ensure('bot_1');
    await configs.update({
      appId: 'cli_app-one',
      appSecret: 'secret',
      botInstanceId: 'bot_1',
      enabled: true,
    });
    const inboundAt = new Date('2026-08-31T02:00:00.000Z');
    const outboundAt = new Date('2026-08-31T02:01:00.000Z');
    await configs.recordActivity({ botInstanceId: 'bot_1', inboundAt });
    await configs.recordActivity({ botInstanceId: 'bot_1', outboundAt });

    const disabled = await configs.disable({
      botInstanceId: 'bot_1',
      updatedByUserId: 'admin',
    });
    expect(disabled).toMatchObject({
      appId: 'cli_app-one',
      appSecret: 'secret',
      enabled: false,
      eventStatus: 'disabled',
      lastInboundAt: inboundAt,
      lastOutboundAt: outboundAt,
    });

    const cleared = await configs.clearCredentials({
      botInstanceId: 'bot_1',
      updatedByUserId: 'admin',
    });
    expect(cleared).toMatchObject({
      appId: '',
      appSecret: '',
      enabled: false,
      eventStatus: 'not_configured',
    });
  });

  it('records the first P2P sender as owner and never overwrites it', async () => {
    const { configs } = await createFixture();
    await configs.ensure('bot_1');
    const recordedAt = new Date('2026-08-31T03:00:00.000Z');

    await configs.recordOwnerOpenId('bot_1', ' ou_owner ', recordedAt);
    await expect(configs.findByBotInstanceId('bot_1')).resolves.toMatchObject({
      ownerOpenId: 'ou_owner',
      updatedAt: recordedAt,
    });

    await configs.recordOwnerOpenId('bot_1', 'ou_other', new Date('2026-08-31T04:00:00.000Z'));
    await expect(configs.findByBotInstanceId('bot_1')).resolves.toMatchObject({
      ownerOpenId: 'ou_owner',
    });
  });
});

describe('BotFeishuEventRepository', () => {
  it('accepts each event once and retains the original receipt on a duplicate', async () => {
    const { client, events } = await createFixture();
    const receivedAt = new Date('2026-08-31T04:00:00.000Z');

    await expect(events.tryAccept({
      botInstanceId: 'bot_1',
      chatId: 'oc_chat',
      eventId: ' event-one ',
      messageId: 'om_message',
      receivedAt,
      senderOpenId: 'ou_user',
    })).resolves.toBe('claimed');
    await expect(events.tryAccept({
      botInstanceId: 'bot_1',
      chatId: 'oc_chat',
      eventId: 'event-one',
      messageId: 'om_message',
      receivedAt: new Date(receivedAt.getTime() + 1_000),
      senderOpenId: 'ou_user',
      staleBefore: new Date(receivedAt.getTime() - 1),
    })).resolves.toBe('processing');

    expect(client.db.select().from(botFeishuEvents).all()).toEqual([
      expect.objectContaining({
        attemptCount: 1,
        botInstanceId: 'bot_1',
        chatId: 'oc_chat',
        completedAt: null,
        error: null,
        eventId: 'event-one',
        messageId: 'om_message',
        receivedAt,
        senderOpenId: 'ou_user',
        status: 'processing',
        updatedAt: receivedAt,
      }),
    ]);
    await expect(events.tryAccept({
      botInstanceId: 'bot_1',
      chatId: 'oc_chat',
      eventId: '   ',
      messageId: 'om_message',
      senderOpenId: 'ou_user',
    })).rejects.toThrow('Feishu event ID is required');
  });

  it('marks accepted events succeeded or failed without creating unknown receipts', async () => {
    const { client, events } = await createFixture();
    for (const eventId of ['success', 'failure']) {
      await expect(events.tryAccept({
        botInstanceId: 'bot_1',
        chatId: 'oc_chat',
        eventId,
        messageId: `om_${eventId}`,
        senderOpenId: 'ou_user',
      })).resolves.toBe('claimed');
    }
    const succeededAt = new Date('2026-08-31T04:05:00.000Z');
    const failedAt = new Date('2026-08-31T04:06:00.000Z');

    await events.markSucceeded('success', succeededAt);
    await events.markFailed('failure', `  ${'f'.repeat(1_100)}  `, failedAt);
    await events.markSucceeded('unknown', failedAt);

    const rows = client.db.select().from(botFeishuEvents).all();
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.eventId === 'success')).toMatchObject({
      completedAt: succeededAt,
      error: null,
      status: 'succeeded',
      updatedAt: succeededAt,
    });
    expect(rows.find((row) => row.eventId === 'failure')).toMatchObject({
      completedAt: failedAt,
      error: 'f'.repeat(1_000),
      status: 'failed',
      updatedAt: failedAt,
    });
  });

  it('reclaims stale processing or failed receipts but never reruns succeeded ones', async () => {
    const { client, events } = await createFixture();
    const firstAt = new Date('2026-08-31T04:00:00.000Z');
    const staleAt = new Date('2026-08-31T04:02:00.000Z');
    const baseInput = {
      botInstanceId: 'bot_1',
      chatId: 'oc_chat',
      senderOpenId: 'ou_user',
    };

    await expect(events.tryAccept({
      ...baseInput,
      eventId: 'processing',
      messageId: 'om_processing',
      receivedAt: firstAt,
    })).resolves.toBe('claimed');
    await expect(events.tryAccept({
      ...baseInput,
      eventId: 'processing',
      messageId: 'om_processing',
      receivedAt: new Date(firstAt.getTime() + 1_000),
      staleBefore: new Date(firstAt.getTime() - 1),
    })).resolves.toBe('processing');
    await expect(events.tryAccept({
      ...baseInput,
      eventId: 'processing',
      messageId: 'om_processing',
      receivedAt: staleAt,
      staleBefore: firstAt,
    })).resolves.toBe('claimed');

    await expect(events.tryAccept({
      ...baseInput,
      eventId: 'succeeded',
      messageId: 'om_succeeded',
      receivedAt: firstAt,
    })).resolves.toBe('claimed');
    await events.markSucceeded('succeeded', firstAt);
    await expect(events.tryAccept({
      ...baseInput,
      eventId: 'succeeded',
      messageId: 'om_succeeded',
      receivedAt: staleAt,
      staleBefore: staleAt,
    })).resolves.toBe('succeeded');

    await expect(events.tryAccept({
      ...baseInput,
      eventId: 'failed',
      messageId: 'om_failed',
      receivedAt: firstAt,
    })).resolves.toBe('claimed');
    await events.markFailed('failed', 'temporary error', firstAt);
    await expect(events.tryAccept({
      ...baseInput,
      eventId: 'failed',
      messageId: 'om_failed',
      receivedAt: new Date(firstAt.getTime() + 1_000),
      staleBefore: new Date(firstAt.getTime() - 1),
    })).resolves.toBe('processing');
    await expect(events.tryAccept({
      ...baseInput,
      eventId: 'failed',
      messageId: 'om_failed',
      receivedAt: staleAt,
      staleBefore: firstAt,
    })).resolves.toBe('claimed');

    expect(client.db.select().from(botFeishuEvents).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventId: 'processing', attemptCount: 2 }),
        expect.objectContaining({ eventId: 'failed', attemptCount: 2 }),
        expect.objectContaining({ eventId: 'succeeded', attemptCount: 1 }),
      ]),
    );
  });
});

async function createFixture(input: { bots?: number } = {}) {
  const client = createDatabaseClient({ url: ':memory:' });
  clients.push(client);
  migrateDatabase(client);

  const users = new UserRepository(client.db);
  const workspaces = new WorkspaceRepository(client.db);
  const botInstances = new BotInstanceRepository(client.db);
  await users.create({ email: 'admin@example.com', id: 'admin', name: 'Admin' });
  await workspaces.create({ id: 'workspace_1', name: 'Workspace', ownerUserId: 'admin' });

  for (let index = 1; index <= (input.bots ?? 1); index += 1) {
    await botInstances.create({
      desiredState: 'running',
      id: `bot_${index}`,
      model: 'test-model',
      name: `Bot ${index}`,
      ownerUserId: 'admin',
      provider: 'test-provider',
      status: 'running',
      workspaceId: 'workspace_1',
    });
  }

  return {
    client,
    configs: new BotFeishuConfigRepository(client.db),
    events: new BotFeishuEventRepository(client.db),
  };
}
