import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabaseClient, migrateDatabase } from '../../client.js';
import { BotInstanceRepository } from '../bot-instance-repository.js';
import { MorningBriefingPolicyRepository } from '../morning-briefing-policy-repository.js';
import { UserRepository } from '../user-repository.js';
import { WorkspaceRepository } from '../workspace-repository.js';

const tempDirs: string[] = [];
const clients: Array<ReturnType<typeof createDatabaseClient>> = [];

afterEach(async () => {
  clients.splice(0).forEach((client) => client.close());
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('MorningBriefingPolicyRepository', () => {
  it('lists every bot for administration in stable creation order', async () => {
    const { botInstances } = await createRepositoryFixture();

    const bots = await botInstances.listAllForAdministration();

    expect(bots.map((bot) => bot.id)).toEqual(['bot_1', 'bot_2']);
  });

  it('materializes the default policy once for a bot', async () => {
    const { policies } = await createRepositoryFixture();
    const now = new Date('2026-07-21T00:00:00.000Z');

    const first = await policies.ensureForBot('bot_1', now);
    const second = await policies.ensureForBot('bot_1', new Date('2026-07-21T00:01:00.000Z'));

    expect(first).toMatchObject({
      adminEnabled: true,
      appliedRevision: 0,
      botInstanceId: 'bot_1',
      centralLastDeliveredAt: null,
      centralLastDeliveryDate: null,
      centralLastError: null,
      centralScheduledFor: null,
      deliveryTime: '08:30',
      desiredRevision: 1,
      forceEnabled: false,
      location: '北京',
      observedUserOptOut: false,
      runtimeNeedsCleanup: false,
      runtimeNeedsSchedule: false,
      runtimeObservedAt: null,
      runtimeScheduledFor: null,
      runtimeScheduleTaskId: null,
      syncStatus: 'pending',
      timezone: 'Asia/Shanghai',
    });
    expect(second).toEqual(first);
  });

  it('increments desired revision only when administrator intent changes', async () => {
    const { policies } = await createRepositoryFixture();
    await policies.ensureForBot('bot_1');

    const unchanged = await policies.patchForBot('bot_1', { location: '北京' });
    const changed = await policies.patchForBot('bot_1', {
      deliveryTime: '09:15',
      location: '北京',
      updatedAt: new Date('2026-07-21T00:02:00.000Z'),
    });

    expect(unchanged?.desiredRevision).toBe(1);
    expect(changed).toMatchObject({
      deliveryTime: '09:15',
      desiredRevision: 2,
      lastSyncError: null,
      location: '北京',
      syncStatus: 'pending',
    });
  });

  it('bulk patches selected bots and all bots while ensuring missing policies', async () => {
    const { policies } = await createRepositoryFixture();

    const selected = await policies.bulkPatch(['bot_1', 'bot_2'], {
      adminEnabled: false,
    });
    const all = await policies.bulkPatchAll({
      deliveryTime: '07:45',
    });

    expect(selected).toHaveLength(2);
    expect(selected.every((policy) => !policy.adminEnabled)).toBe(true);
    expect(all).toHaveLength(2);
    expect(all.every((policy) => policy.deliveryTime === '07:45')).toBe(true);
  });

  it('records employee opt-out and supervisor sync facts without changing desired revision', async () => {
    const { policies } = await createRepositoryFixture();
    await policies.ensureForBot('bot_1');

    const observed = await policies.markObservedUserOptOut(
      'bot_1',
      true,
      new Date('2026-07-21T00:03:00.000Z'),
    );
    const synced = await policies.markSyncSucceeded('bot_1', {
      appliedRevision: 1,
      lastSyncedAt: new Date('2026-07-21T00:04:00.000Z'),
      observedUserOptOut: true,
      runtimeNeedsCleanup: false,
      runtimeNeedsSchedule: false,
      runtimeScheduledFor: '2026-07-22T00:30:00.000Z',
      runtimeScheduleTaskId: 'cron_123',
    });

    expect(observed).toMatchObject({
      desiredRevision: 1,
      observedUserOptOut: true,
    });
    expect(synced).toMatchObject({
      appliedRevision: 1,
      desiredRevision: 1,
      lastSyncError: null,
      runtimeObservedAt: new Date('2026-07-21T00:04:00.000Z'),
      runtimeScheduledFor: '2026-07-22T00:30:00.000Z',
      runtimeScheduleTaskId: 'cron_123',
      syncStatus: 'synced',
    });
  });

  it('keeps the last applied revision when supervisor records an error', async () => {
    const { policies } = await createRepositoryFixture();
    await policies.ensureForBot('bot_1');

    const failed = await policies.markSyncFailed('bot_1', {
      error: 'workspace unavailable',
      lastSyncedAt: new Date('2026-07-21T00:04:00.000Z'),
    });

    expect(failed).toMatchObject({
      appliedRevision: 0,
      lastSyncError: 'workspace unavailable',
      syncStatus: 'error',
    });
  });

  it('persists central schedules, successful delivery, and retryable failures', async () => {
    const { policies } = await createRepositoryFixture();
    await policies.ensureForBot('bot_1');

    const scheduled = await policies.updateCentralSchedule(
      'bot_1',
      '2026-07-24T00:30:00.000Z',
      new Date('2026-07-23T23:00:00.000Z'),
    );
    const failed = await policies.markCentralDeliveryFailed('bot_1', {
      deliveryDate: '2026-07-24',
      error: 'Bot process is not running.',
      failedAt: new Date('2026-07-24T00:30:01.000Z'),
      nextScheduledFor: '2026-07-24T00:45:01.000Z',
    });
    const delivered = await policies.markCentralDeliverySucceeded('bot_1', {
      deliveredAt: new Date('2026-07-24T00:31:00.000Z'),
      deliveryDate: '2026-07-24',
      nextScheduledFor: '2026-07-27T00:30:00.000Z',
    });

    expect(scheduled?.centralScheduledFor).toBe('2026-07-24T00:30:00.000Z');
    expect(failed).toMatchObject({
      centralLastDeliveryDate: '2026-07-24',
      centralLastError: 'Bot process is not running.',
      centralScheduledFor: '2026-07-24T00:45:01.000Z',
    });
    expect(delivered).toMatchObject({
      centralLastDeliveredAt: new Date('2026-07-24T00:31:00.000Z'),
      centralLastDeliveryDate: '2026-07-24',
      centralLastError: null,
      centralScheduledFor: '2026-07-27T00:30:00.000Z',
    });
  });

  it('invalidates a central schedule when administrator intent changes', async () => {
    const { policies } = await createRepositoryFixture();
    await policies.ensureForBot('bot_1');
    await policies.updateCentralSchedule('bot_1', '2026-07-24T00:30:00.000Z');
    await policies.markCentralDeliveryFailed('bot_1', {
      deliveryDate: '2026-07-24',
      error: 'temporary failure',
      nextScheduledFor: '2026-07-24T00:35:00.000Z',
    });

    const updated = await policies.patchForBot('bot_1', { deliveryTime: '09:15' });

    expect(updated).toMatchObject({
      centralLastError: null,
      centralScheduledFor: null,
      deliveryTime: '09:15',
    });
  });

  it('cascades policy deletion with its bot', async () => {
    const { client, policies } = await createRepositoryFixture();
    await policies.ensureForBot('bot_1');

    client.connection.prepare("DELETE FROM bot_instances WHERE id = 'bot_1'").run();

    await expect(policies.findByBotId('bot_1')).resolves.toBeNull();
  });

  it('rejects malformed delivery times and revision regressions', async () => {
    const { policies } = await createRepositoryFixture();
    await policies.ensureForBot('bot_1');

    await expect(policies.patchForBot('bot_1', { deliveryTime: '24:00' }))
      .rejects.toThrow('Morning briefing deliveryTime must use HH:mm in 24-hour time.');
    await expect(policies.markSyncSucceeded('bot_1', {
      appliedRevision: 2,
      observedUserOptOut: false,
      runtimeNeedsCleanup: false,
      runtimeNeedsSchedule: true,
      runtimeScheduledFor: null,
      runtimeScheduleTaskId: null,
    })).rejects.toThrow('Applied morning briefing revision cannot exceed desired revision.');
  });
});

async function createRepositoryFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-morning-briefing-'));
  tempDirs.push(dir);

  const client = createDatabaseClient({
    url: `file:${join(dir, 'test.sqlite')}`,
  });
  clients.push(client);
  migrateDatabase(client);

  const users = new UserRepository(client.db);
  const workspaces = new WorkspaceRepository(client.db);
  const botInstances = new BotInstanceRepository(client.db);

  await users.create({ email: 'admin@example.com', id: 'user_1', name: 'admin' });
  await workspaces.create({ id: 'ws_1', name: 'One', ownerUserId: 'user_1' });
  await workspaces.create({ id: 'ws_2', name: 'Two', ownerUserId: 'user_1' });
  await botInstances.create({
    desiredState: 'running',
    id: 'bot_1',
    model: 'test-model',
    name: 'Bot One',
    ownerUserId: 'user_1',
    provider: 'openai',
    status: 'stopped',
    workspaceId: 'ws_1',
  });
  await botInstances.create({
    desiredState: 'running',
    id: 'bot_2',
    model: 'test-model',
    name: 'Bot Two',
    ownerUserId: 'user_1',
    provider: 'openai',
    status: 'stopped',
    workspaceId: 'ws_2',
  });

  return {
    botInstances,
    client,
    policies: new MorningBriefingPolicyRepository(client.db),
  };
}
