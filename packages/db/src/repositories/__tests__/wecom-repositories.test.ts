import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDatabaseClient, migrateDatabase } from '../../client.js';
import { employeeDirectoryEntries } from '../../schema/employee-directory-entries.js';
import { wecomMessageReceipts } from '../../schema/wecom-message-receipts.js';
import { wecomProactiveDeliveries } from '../../schema/wecom-proactive-deliveries.js';
import { BotInstanceRepository } from '../bot-instance-repository.js';
import { BotWecomBindingRepository } from '../bot-wecom-binding-repository.js';
import { EmployeeDirectoryRepository } from '../employee-directory-repository.js';
import { GlobalWecomConfigRepository } from '../global-wecom-config-repository.js';
import { UserRepository } from '../user-repository.js';
import { WecomMessageReceiptRepository } from '../wecom-message-receipt-repository.js';
import { WecomProactiveDeliveryRepository } from '../wecom-proactive-delivery-repository.js';
import { WorkspaceRepository } from '../workspace-repository.js';

const clients: Array<ReturnType<typeof createDatabaseClient>> = [];

afterEach(() => clients.splice(0).forEach((client) => client.close()));

describe('GlobalWecomConfigRepository', () => {
  it('ensures one default config and preserves its creation time', async () => {
    const { configs } = await createFixture();
    const createdAt = new Date('2026-07-27T01:00:00.000Z');

    expect(await configs.find()).toBeNull();
    const created = await configs.ensure(createdAt);
    const ensuredAgain = await configs.ensure(new Date('2026-07-27T02:00:00.000Z'));

    expect(created).toMatchObject({
      botId: '',
      connectionStatus: 'disabled',
      createdAt,
      enabled: false,
      id: 'global',
      revision: 1,
      secret: '',
      updatedAt: createdAt,
      wsUrl: 'wss://openws.work.weixin.qq.com',
    });
    expect(ensuredAgain).toEqual(created);
  });

  it('normalizes updates, preserves an omitted secret, and advances revision only on change', async () => {
    const { configs } = await createFixture();
    await configs.ensure(new Date('2026-07-27T01:00:00.000Z'));
    const updatedAt = new Date('2026-07-27T01:05:00.000Z');

    const enabled = await configs.update({
      botId: ' bot-one ',
      enabled: true,
      secret: ' secret-one ',
      updatedAt,
      updatedByUserId: 'admin',
      wsUrl: ' ws://wecom.example.com/socket/ ',
    });
    const unchanged = await configs.update({
      botId: 'bot-one',
      enabled: true,
      secret: '   ',
      updatedByUserId: 'admin',
      wsUrl: 'ws://wecom.example.com/socket',
    });

    expect(enabled).toMatchObject({
      botId: 'bot-one',
      connectionStatus: 'connecting',
      enabled: true,
      observedRevision: null,
      revision: 2,
      secret: 'secret-one',
      updatedAt,
      updatedByUserId: 'admin',
      wsUrl: 'ws://wecom.example.com/socket',
    });
    expect(unchanged).toEqual(enabled);
  });

  it('requires a complete enabled config and a WS or WSS endpoint', async () => {
    const { configs } = await createFixture();
    await configs.ensure();

    await expect(configs.update({
      botId: '   ',
      enabled: true,
      secret: 'secret',
      updatedByUserId: 'admin',
    })).rejects.toThrow('WeCom Bot ID is required');
    await expect(configs.update({
      botId: 'bot-one',
      enabled: true,
      updatedByUserId: 'admin',
    })).rejects.toThrow('WeCom Secret is required');
    await expect(configs.update({
      botId: 'bot-one',
      enabled: true,
      secret: 'secret',
      updatedByUserId: 'admin',
      wsUrl: 'https://wecom.example.com/socket',
    })).rejects.toThrow('WeCom WebSocket URL must use WS or WSS');
  });

  it('records connection state only for the current revision and sanitizes blank errors', async () => {
    const { configs } = await createFixture();
    await configs.ensure();
    const enabled = await configs.update({
      botId: 'bot-one',
      enabled: true,
      secret: 'secret',
      updatedByUserId: 'admin',
    });
    const connectedAt = new Date('2026-07-27T01:10:00.000Z');
    const connected = await configs.recordConnectionStatus({
      connectedAt,
      error: '   ',
      observedRevision: enabled.revision,
      status: 'connected',
      updatedAt: connectedAt,
    });
    const stale = await configs.recordConnectionStatus({
      error: 'stale failure',
      observedRevision: enabled.revision - 1,
      status: 'error',
    });

    expect(connected).toMatchObject({
      connectionStatus: 'connected',
      lastConnectedAt: connectedAt,
      lastError: null,
      observedRevision: enabled.revision,
      revision: enabled.revision,
    });
    expect(stale).toEqual(connected);
  });

  it('requests reconnect by advancing revision and resetting connection convergence state', async () => {
    const { configs } = await createFixture();
    await configs.ensure();
    const enabled = await configs.update({
      botId: 'bot-one',
      enabled: true,
      secret: 'secret',
      updatedByUserId: 'admin',
      wsUrl: 'wss://wecom.example.com/socket',
    });
    await configs.recordConnectionStatus({
      error: 'connection lost',
      observedRevision: enabled.revision,
      status: 'error',
    });
    const firstRequestedAt = new Date('2026-07-27T01:15:00.000Z');
    const secondRequestedAt = new Date('2026-07-27T01:16:00.000Z');

    const first = await configs.requestReconnect({
      requestedAt: firstRequestedAt,
      updatedByUserId: 'admin',
    });
    const second = await configs.requestReconnect({
      requestedAt: secondRequestedAt,
      updatedByUserId: 'admin',
    });

    expect(first).toMatchObject({
      botId: enabled.botId,
      connectionStatus: 'connecting',
      lastError: null,
      observedRevision: null,
      revision: enabled.revision + 1,
      secret: enabled.secret,
      updatedAt: firstRequestedAt,
      updatedByUserId: 'admin',
      wsUrl: enabled.wsUrl,
    });
    expect(second).toMatchObject({
      connectionStatus: 'connecting',
      lastError: null,
      observedRevision: null,
      revision: enabled.revision + 2,
      updatedAt: secondRequestedAt,
      updatedByUserId: 'admin',
    });
  });

  it('rejects reconnect while the global WeCom connection is disabled', async () => {
    const { configs } = await createFixture();
    const disabled = await configs.ensure(new Date('2026-07-27T01:00:00.000Z'));

    await expect(configs.requestReconnect({
      requestedAt: new Date('2026-07-27T01:15:00.000Z'),
      updatedByUserId: 'admin',
    })).rejects.toThrow('Global WeCom config must be enabled before reconnect');
    await expect(configs.find()).resolves.toEqual(disabled);
  });
});

describe('BotWecomBindingRepository', () => {
  it('upserts a normalized binding and maps its employee and bot fields', async () => {
    const { bindings } = await createFixture({ employees: 1 });
    const createdAt = new Date('2026-07-27T02:00:00.000Z');
    const updatedAt = new Date('2026-07-27T02:05:00.000Z');

    const created = await bindings.upsert({
      botInstanceId: 'bot_1',
      employeeId: 'employee_1',
      updatedAt: createdAt,
      wecomUserId: ' zhang.ting ',
    });
    const updated = await bindings.upsert({
      botInstanceId: 'bot_1',
      employeeId: 'employee_1',
      enabled: false,
      preferredForProactive: false,
      updatedAt,
      wecomUserId: 'zhang.ting.2',
    });

    expect(created).toMatchObject({
      botInstanceId: 'bot_1',
      createdAt,
      employeeEnabled: true,
      employeeId: 'employee_1',
      enabled: true,
      legalName: 'Employee 1',
      nickname: 'E1',
      preferredForProactive: true,
      wecomUserId: 'zhang.ting',
    });
    expect(updated).toMatchObject({
      createdAt,
      enabled: false,
      preferredForProactive: false,
      updatedAt,
      wecomUserId: 'zhang.ting.2',
    });
    await expect(bindings.listAll()).resolves.toEqual([updated]);
  });

  it('requires an existing Bot, validates optional employee metadata, and validates the WeCom user ID', async () => {
    const { bindings, client } = await createFixture({ employees: 1 });

    await expect(bindings.upsert({
      botInstanceId: 'missing',
      wecomUserId: 'missing',
    })).rejects.toThrow('Bot does not exist');
    await expect(bindings.upsert({
      botInstanceId: 'bot_1',
      employeeId: 'missing',
      wecomUserId: 'missing',
    })).rejects.toThrow('Employee does not exist');

    await client.db.update(employeeDirectoryEntries)
      .set({ claimedBotInstanceId: null })
      .where(eq(employeeDirectoryEntries.id, 'employee_1'));

    await expect(bindings.upsert({
      botInstanceId: 'bot_1',
      employeeId: 'employee_1',
      wecomUserId: 'valid',
    })).rejects.toThrow('Employee is not associated with this Bot');

    await client.db.update(employeeDirectoryEntries)
      .set({ claimedBotInstanceId: 'bot_1' })
      .where(eq(employeeDirectoryEntries.id, 'employee_1'));
    await expect(bindings.upsert({
      botInstanceId: 'bot_1',
      wecomUserId: '   ',
    })).rejects.toThrow('Invalid WeCom user ID');
    await expect(bindings.upsert({
      botInstanceId: 'bot_1',
      wecomUserId: 'x'.repeat(129),
    })).rejects.toThrow('Invalid WeCom user ID');
  });

  it('enforces unique WeCom users and filters inactive or non-preferred bindings', async () => {
    const { bindings, client } = await createFixture({ employees: 2 });
    await bindings.upsert({ botInstanceId: 'bot_1', employeeId: 'employee_1', wecomUserId: 'user-one' });
    await bindings.upsert({ botInstanceId: 'bot_2', employeeId: 'employee_2', wecomUserId: 'user-two' });

    await expect(bindings.findActiveByWecomUserId(' user-one ')).resolves.toMatchObject({
      employeeId: 'employee_1',
    });
    await expect(bindings.findPreferredByBotInstanceId('bot_1')).resolves.toMatchObject({
      employeeId: 'employee_1',
    });
    await expect(bindings.upsert({
      botInstanceId: 'bot_2',
      employeeId: 'employee_2',
      wecomUserId: 'user-one',
    })).rejects.toThrow();

    await bindings.upsert({
      botInstanceId: 'bot_1',
      employeeId: 'employee_1',
      enabled: false,
      wecomUserId: 'user-one',
    });
    await expect(bindings.findActiveByWecomUserId('user-one')).resolves.toBeNull();
    await expect(bindings.findPreferredByBotInstanceId('bot_1')).resolves.toBeNull();

    await bindings.upsert({ botInstanceId: 'bot_1', employeeId: 'employee_1', wecomUserId: 'user-one' });
    await client.db.delete(employeeDirectoryEntries)
      .where(eq(employeeDirectoryEntries.id, 'employee_1'));
    await expect(bindings.findActiveByWecomUserId('user-one')).resolves.toMatchObject({
      botInstanceId: 'bot_1',
      employeeEnabled: null,
      employeeId: null,
    });
    await expect(bindings.findPreferredByBotInstanceId('bot_1')).resolves.toMatchObject({
      employeeId: null,
    });
  });

  it('records activity and bounded errors, then deletes the binding', async () => {
    const { bindings } = await createFixture({ employees: 1 });
    await bindings.upsert({ botInstanceId: 'bot_1', wecomUserId: 'user-one' });
    const inboundAt = new Date('2026-07-27T03:00:00.000Z');
    const outboundAt = new Date('2026-07-27T03:01:00.000Z');
    const errorAt = new Date('2026-07-27T03:02:00.000Z');

    await bindings.recordInbound('bot_1', inboundAt);
    await bindings.recordOutbound('bot_1', outboundAt);
    await bindings.recordError('bot_1', `  ${'e'.repeat(1_100)}  `, errorAt);

    await expect(bindings.findByBotInstanceId('bot_1')).resolves.toMatchObject({
      employeeId: null,
      lastError: 'e'.repeat(1_000),
      lastInboundAt: inboundAt,
      lastOutboundAt: outboundAt,
      updatedAt: errorAt,
    });
    await expect(bindings.deleteByBotInstanceId('bot_1')).resolves.toBe(true);
    await expect(bindings.deleteByBotInstanceId('bot_1')).resolves.toBe(false);
  });
});

describe('WecomMessageReceiptRepository', () => {
  it('accepts each message once and retains the original receipt on a duplicate', async () => {
    const { client, receipts } = await createFixture({ employees: 1 });
    const receivedAt = new Date('2026-07-27T04:00:00.000Z');

    await expect(receipts.tryAccept({
      botInstanceId: 'bot_1',
      messageId: ' message-one ',
      receivedAt,
    })).resolves.toBe('claimed');
    await expect(receipts.tryAccept({
      botInstanceId: 'bot_2',
      messageId: 'message-one',
      receivedAt: new Date(receivedAt.getTime() + 1_000),
      staleBefore: new Date(receivedAt.getTime() - 1),
    })).resolves.toBe('processing');

    expect(client.db.select().from(wecomMessageReceipts).all()).toEqual([
      expect.objectContaining({
        botInstanceId: 'bot_1',
        attemptCount: 1,
        completedAt: null,
        error: null,
        messageId: 'message-one',
        receivedAt,
        status: 'processing',
        updatedAt: receivedAt,
      }),
    ]);
    await expect(receipts.tryAccept({
      botInstanceId: 'bot_1',
      messageId: '   ',
    })).rejects.toThrow('WeCom message ID is required');
  });

  it('marks accepted messages succeeded or failed without creating unknown receipts', async () => {
    const { client, receipts } = await createFixture({ employees: 1 });
    await expect(receipts.tryAccept({
      botInstanceId: 'bot_1',
      messageId: 'success',
    })).resolves.toBe('claimed');
    await expect(receipts.tryAccept({
      botInstanceId: 'bot_1',
      messageId: 'failure',
    })).resolves.toBe('claimed');
    const succeededAt = new Date('2026-07-27T04:05:00.000Z');
    const failedAt = new Date('2026-07-27T04:06:00.000Z');

    await receipts.markSucceeded('success', succeededAt);
    await receipts.markFailed('failure', `  ${'f'.repeat(1_100)}  `, failedAt);
    await receipts.markSucceeded('unknown', failedAt);

    const rows = client.db.select().from(wecomMessageReceipts).all();
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.messageId === 'success')).toMatchObject({
      completedAt: succeededAt,
      error: null,
      status: 'succeeded',
      updatedAt: succeededAt,
    });
    expect(rows.find((row) => row.messageId === 'failure')).toMatchObject({
      completedAt: failedAt,
      error: 'f'.repeat(1_000),
      status: 'failed',
      updatedAt: failedAt,
    });
  });

  it('reclaims stale processing or failed receipts but never reruns fresh or succeeded ones', async () => {
    const { client, receipts } = await createFixture({ employees: 1 });
    const firstAt = new Date('2026-07-27T04:00:00.000Z');
    const staleAt = new Date('2026-07-27T04:02:00.000Z');

    await expect(receipts.tryAccept({
      botInstanceId: 'bot_1',
      messageId: 'processing',
      receivedAt: firstAt,
    })).resolves.toBe('claimed');
    await expect(receipts.tryAccept({
      botInstanceId: 'bot_1',
      messageId: 'processing',
      receivedAt: new Date(firstAt.getTime() + 1_000),
      staleBefore: new Date(firstAt.getTime() - 1),
    })).resolves.toBe('processing');
    await expect(receipts.tryAccept({
      botInstanceId: 'bot_1',
      messageId: 'processing',
      receivedAt: staleAt,
      staleBefore: firstAt,
    })).resolves.toBe('claimed');

    await expect(receipts.tryAccept({
      botInstanceId: 'bot_1',
      messageId: 'succeeded',
      receivedAt: firstAt,
    })).resolves.toBe('claimed');
    await receipts.markSucceeded('succeeded', firstAt);
    await expect(receipts.tryAccept({
      botInstanceId: 'bot_1',
      messageId: 'succeeded',
      receivedAt: staleAt,
      staleBefore: staleAt,
    })).resolves.toBe('succeeded');

    await expect(receipts.tryAccept({
      botInstanceId: 'bot_1',
      messageId: 'failed',
      receivedAt: firstAt,
    })).resolves.toBe('claimed');
    await receipts.markFailed('failed', 'temporary error', firstAt);
    await expect(receipts.tryAccept({
      botInstanceId: 'bot_1',
      messageId: 'failed',
      receivedAt: new Date(firstAt.getTime() + 1_000),
      staleBefore: new Date(firstAt.getTime() - 1),
    })).resolves.toBe('processing');
    await expect(receipts.tryAccept({
      botInstanceId: 'bot_1',
      messageId: 'failed',
      receivedAt: staleAt,
      staleBefore: firstAt,
    })).resolves.toBe('claimed');

    expect(client.db.select().from(wecomMessageReceipts).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageId: 'processing', attemptCount: 2 }),
        expect.objectContaining({ messageId: 'failed', attemptCount: 2 }),
        expect.objectContaining({ messageId: 'succeeded', attemptCount: 1 }),
      ]),
    );
  });
});

describe('WecomProactiveDeliveryRepository', () => {
  it('deduplicates stable semantic keys and does not retry a sent delivery', async () => {
    const { proactive } = await createFixture({ employees: 1 });
    const firstAt = new Date('2026-07-27T05:00:00.000Z');

    await expect(proactive.claim({
      botInstanceId: 'bot_1',
      deliveryId: 'delivery_1',
      now: firstAt,
      semanticKey: 'lunch:employee_1:2026-07-27',
    })).resolves.toBe('claimed');
    await expect(proactive.claim({
      botInstanceId: 'bot_1',
      deliveryId: 'delivery_1',
      now: new Date(firstAt.getTime() + 1_000),
      semanticKey: 'lunch:employee_1:2026-07-27',
      staleBefore: new Date(firstAt.getTime() - 1),
    })).resolves.toBe('processing');

    await expect(proactive.markSent('delivery_1', firstAt)).resolves.toBe(true);
    await expect(proactive.markSent('delivery_1', new Date(firstAt.getTime() + 1_000)))
      .resolves.toBe(false);
    await expect(proactive.claim({
      botInstanceId: 'bot_1',
      deliveryId: 'delivery_1',
      now: new Date(firstAt.getTime() + 120_000),
      semanticKey: 'lunch:employee_1:2026-07-27',
      staleBefore: firstAt,
    })).resolves.toBe('sent');

    await expect(proactive.findBySemanticKey(' lunch:employee_1:2026-07-27 '))
      .resolves.toMatchObject({
        attemptCount: 1,
        deliveryId: 'delivery_1',
        sentAt: firstAt,
        status: 'sent',
      });
  });

  it('reclaims stale failed deliveries and rejects identity collisions', async () => {
    const { proactive, client } = await createFixture({ employees: 1 });
    const firstAt = new Date('2026-07-27T05:00:00.000Z');
    const staleAt = new Date('2026-07-27T05:02:00.000Z');
    await expect(proactive.claim({
      botInstanceId: 'bot_1',
      deliveryId: 'delivery_2',
      now: firstAt,
      semanticKey: 'briefing:employee_1:2026-07-27',
    })).resolves.toBe('claimed');
    await expect(proactive.markFailed('delivery_2', ' upstream timeout ', firstAt))
      .resolves.toBe(true);
    await expect(proactive.claim({
      botInstanceId: 'bot_1',
      deliveryId: 'delivery_2',
      now: new Date(firstAt.getTime() + 1_000),
      semanticKey: 'briefing:employee_1:2026-07-27',
      staleBefore: new Date(firstAt.getTime() - 1),
    })).resolves.toBe('failed');
    await expect(proactive.claim({
      botInstanceId: 'bot_1',
      deliveryId: 'delivery_2',
      now: staleAt,
      semanticKey: 'briefing:employee_1:2026-07-27',
      staleBefore: firstAt,
    })).resolves.toBe('claimed');
    await expect(proactive.claim({
      botInstanceId: 'bot_1',
      deliveryId: 'different-delivery',
      semanticKey: 'briefing:employee_1:2026-07-27',
    })).rejects.toThrow('identity conflict');

    expect(client.db.select().from(wecomProactiveDeliveries).all()).toEqual([
      expect.objectContaining({
        attemptCount: 2,
        deliveryId: 'delivery_2',
        lastError: null,
        status: 'delivering',
      }),
    ]);
  });
});

async function createFixture(input: { employees?: number } = {}) {
  const client = createDatabaseClient({ url: ':memory:' });
  clients.push(client);
  migrateDatabase(client);

  const users = new UserRepository(client.db);
  const directory = new EmployeeDirectoryRepository(client.db);
  const workspaces = new WorkspaceRepository(client.db);
  const botInstances = new BotInstanceRepository(client.db);
  await users.create({ email: 'admin@example.com', id: 'admin', name: 'Admin' });

  if ((input.employees ?? 0) > 0) {
    await workspaces.create({ id: 'workspace_1', name: 'Workspace', ownerUserId: 'admin' });
  }

  for (let index = 1; index <= (input.employees ?? 0); index += 1) {
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
    await directory.create({
      id: `employee_${index}`,
      legalName: `Employee ${index}`,
      nickname: `E${index}`,
      normalizedLegalName: `employee ${index}`,
      normalizedNickname: `e${index}`,
    });
    await client.db.update(employeeDirectoryEntries)
      .set({ claimedBotInstanceId: `bot_${index}` })
      .where(eq(employeeDirectoryEntries.id, `employee_${index}`));
  }

  return {
    bindings: new BotWecomBindingRepository(client.db),
    client,
    configs: new GlobalWecomConfigRepository(client.db),
    proactive: new WecomProactiveDeliveryRepository(client.db),
    receipts: new WecomMessageReceiptRepository(client.db),
  };
}
