import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabaseClient, migrateDatabase } from '../../client.js';
import { AdminMessageDeliveryRepository } from '../admin-message-delivery-repository.js';
import { BotInstanceRepository } from '../bot-instance-repository.js';
import { GlobalAdminMessageConfigRepository } from '../global-admin-message-config-repository.js';
import { MealReminderPreferenceRepository } from '../meal-reminder-preference-repository.js';
import { UserRepository } from '../user-repository.js';
import { WorkspaceRepository } from '../workspace-repository.js';

const tempDirs: string[] = [];
const clients: Array<ReturnType<typeof createDatabaseClient>> = [];

afterEach(async () => {
  clients.splice(0).forEach((client) => client.close());
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('AdminMessageDeliveryRepository', () => {
  it('creates and atomically claims a durable delivery batch', async () => {
    const { deliveries } = await createFixture();
    const createdAt = new Date('2026-07-23T02:00:00.000Z');
    await deliveries.createBatch([{
      batchId: 'batch_1',
      botInstanceId: 'bot_1',
      createdByUserId: 'user_1',
      id: 'delivery_1',
      message: '通知内容',
      recipientUserId: 'user_1',
    }], createdAt);

    const claimed = await deliveries.claimReady({ now: createdAt });
    const claimedAgain = await deliveries.claimReady({ now: createdAt });

    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      attemptCount: 1,
      id: 'delivery_1',
      status: 'delivering',
    });
    expect(claimedAgain).toEqual([]);
  });

  it('idempotently reuses matching IDs and rejects conflicting delivery identities', async () => {
    const { deliveries } = await createFixture();
    const input = {
      batchId: 'scheduled:meal:bot_1:2026-07-23',
      botInstanceId: 'bot_1',
      createdByUserId: 'user_1',
      id: 'meal:bot_1:2026-07-23',
      message: '午餐提醒',
      recipientUserId: 'user_1',
    };

    await deliveries.createBatch([input]);
    await expect(deliveries.createBatch([input])).resolves.toEqual([
      expect.objectContaining({ id: input.id, message: input.message }),
    ]);
    expect(await deliveries.listRecent()).toHaveLength(1);

    await expect(deliveries.createBatch([{
      ...input,
      botInstanceId: 'bot_missing',
    }])).rejects.toThrow(`identity conflict: ${input.id}`);
    await expect(deliveries.createBatch([{
      ...input,
      message: '不同的提醒',
    }])).rejects.toThrow(`identity conflict: ${input.id}`);
  });

  it('requeues failures and stops after the maximum attempt count', async () => {
    const { deliveries } = await createFixture();
    const now = new Date('2026-07-23T02:00:00.000Z');
    await deliveries.createBatch([{
      batchId: 'batch_1',
      botInstanceId: 'bot_1',
      createdByUserId: 'user_1',
      id: 'delivery_1',
      message: '通知内容',
      recipientUserId: 'user_1',
    }], now);
    await deliveries.claimReady({ now });

    await expect(deliveries.markAttemptFailed({
      error: 'not running',
      id: 'delivery_1',
      maxAttempts: 1,
      nextAttemptAt: new Date(now.getTime() + 5_000),
      updatedAt: now,
    })).resolves.toBe('failed');
    expect((await deliveries.listRecent())[0]).toMatchObject({
      lastError: 'not running',
      status: 'failed',
    });
  });

  it('holds exhausted deliveries until the matching Bot becomes active again', async () => {
    const { deliveries } = await createFixture();
    const now = new Date('2026-07-23T02:00:00.000Z');
    await deliveries.createBatch([{
      batchId: 'batch_1',
      botInstanceId: 'bot_1',
      createdByUserId: 'user_1',
      id: 'delivery_1',
      message: 'queued notice',
      recipientUserId: 'user_1',
    }], now);
    await deliveries.claimReady({ now });

    await expect(deliveries.markAttemptFailed({
      deferAfterMaxAttempts: true,
      error: 'conversation unavailable',
      id: 'delivery_1',
      maxAttempts: 1,
      nextAttemptAt: new Date(now.getTime() + 5_000),
      updatedAt: now,
    })).resolves.toBe('waiting_for_user');
    await expect(deliveries.claimReady({ now: new Date(now.getTime() + 60_000) }))
      .resolves.toEqual([]);
    await deliveries.markSent('delivery_1', new Date(now.getTime() + 70_000));
    expect((await deliveries.listRecent())[0]).toMatchObject({
      sentAt: null,
      status: 'waiting_for_user',
    });

    const resumedAt = new Date(now.getTime() + 90_000);
    await expect(deliveries.resumeWaitingForBot('bot_1', resumedAt)).resolves.toBe(1);
    const resumed = await deliveries.claimReady({ botInstanceId: 'bot_1', now: resumedAt });
    expect(resumed[0]).toMatchObject({
      attemptCount: 1,
      id: 'delivery_1',
      status: 'delivering',
    });
    const sentAt = new Date(now.getTime() + 91_000);
    await deliveries.markSent('delivery_1', sentAt);
    await expect(deliveries.markAttemptFailed({
      deferAfterMaxAttempts: true,
      error: 'late worker failure',
      id: 'delivery_1',
      maxAttempts: 1,
      nextAttemptAt: new Date(now.getTime() + 120_000),
    })).resolves.toBe('sent');
    expect((await deliveries.listRecent())[0]).toMatchObject({
      lastError: null,
      sentAt,
      status: 'sent',
    });
  });

  it('terminally fails waiting deliveries when deferred delivery is disabled', async () => {
    const { deliveries } = await createFixture();
    const now = new Date('2026-07-23T02:00:00.000Z');
    await deliveries.createBatch([{
      batchId: 'batch_1',
      botInstanceId: 'bot_1',
      createdByUserId: 'user_1',
      id: 'delivery_1',
      message: 'queued notice',
      recipientUserId: 'user_1',
    }], now);
    await deliveries.claimReady({ now });
    await deliveries.markAttemptFailed({
      deferAfterMaxAttempts: true,
      error: 'conversation unavailable',
      id: 'delivery_1',
      maxAttempts: 1,
      nextAttemptAt: new Date(now.getTime() + 5_000),
      updatedAt: now,
    });

    const failedAt = new Date(now.getTime() + 10_000);
    await expect(deliveries.failWaiting(failedAt)).resolves.toBe(1);
    await expect(deliveries.resumeWaitingForBot('bot_1', failedAt)).resolves.toBe(0);
    expect((await deliveries.listRecent())[0]).toMatchObject({
      lastError: 'conversation unavailable',
      status: 'failed',
      updatedAt: failedAt,
    });
  });
});

describe('GlobalAdminMessageConfigRepository', () => {
  it('defaults deferred delivery on and persists the administrator switch', async () => {
    const { client, configs } = await createFixture();
    const createdAt = new Date('2026-07-23T01:00:00.000Z');
    const updatedAt = new Date('2026-07-23T01:01:00.000Z');

    const ensured = await configs.ensure(createdAt);
    expect(ensured).toMatchObject({
      deferFailedUntilUserActive: true,
      id: 'global',
    });
    const updated = await configs.update({
      deferFailedUntilUserActive: false,
      updatedAt,
    });
    const unchanged = await configs.update({
      deferFailedUntilUserActive: false,
      updatedAt: new Date('2026-07-23T01:02:00.000Z'),
    });

    expect(updated).toMatchObject({
      createdAt: ensured.createdAt,
      deferFailedUntilUserActive: false,
      updatedAt,
    });
    expect(unchanged).toEqual(updated);
    expect(client.connection.prepare(
      'SELECT COUNT(*) AS count FROM global_admin_message_configs',
    ).get()).toEqual({ count: 1 });
  });
});

describe('MealReminderPreferenceRepository', () => {
  it('materializes one default per bot and records opt-in and successful delivery', async () => {
    const { meals } = await createFixture();
    const now = new Date('2026-07-23T02:00:00.000Z');

    expect(await meals.ensureForAllBots(now)).toEqual([
      expect.objectContaining({ botInstanceId: 'bot_1', city: '北京', status: 'unasked' }),
    ]);
    expect(await meals.listUnasked()).toEqual([
      expect.objectContaining({ botInstanceId: 'bot_1', status: 'unasked' }),
    ]);
    await meals.setStatus('bot_1', 'prompted', now);
    expect(await meals.listUnasked()).toEqual([]);
    await meals.setStatus('bot_1', 'enabled', now);
    await meals.markReminded('bot_1', '2026-07-23', now);

    expect(await meals.listEnabled()).toEqual([
      expect.objectContaining({
        botInstanceId: 'bot_1',
        lastReminderDate: '2026-07-23',
        status: 'enabled',
      }),
    ]);
  });
});

async function createFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'weiling-admin-message-meal-'));
  tempDirs.push(dir);
  const client = createDatabaseClient({ url: `file:${join(dir, 'test.sqlite')}` });
  clients.push(client);
  migrateDatabase(client);
  const users = new UserRepository(client.db);
  const workspaces = new WorkspaceRepository(client.db);
  const bots = new BotInstanceRepository(client.db);
  await users.create({ email: 'admin@example.com', id: 'user_1', name: 'admin' });
  await workspaces.create({ id: 'ws_1', name: 'One', ownerUserId: 'user_1' });
  await bots.create({
    desiredState: 'running',
    id: 'bot_1',
    model: 'test-model',
    name: 'Bot One',
    ownerUserId: 'user_1',
    provider: 'openai',
    status: 'running',
    workspaceId: 'ws_1',
  });
  return {
    client,
    configs: new GlobalAdminMessageConfigRepository(client.db),
    deliveries: new AdminMessageDeliveryRepository(client.db),
    meals: new MealReminderPreferenceRepository(client.db),
  };
}
