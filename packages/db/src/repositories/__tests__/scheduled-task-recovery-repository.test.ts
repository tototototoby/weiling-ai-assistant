import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseClient, migrateDatabase } from '../../client.js';
import { scheduledTaskRecoveries } from '../../schema/scheduled-task-recoveries.js';
import { BotInstanceRepository } from '../bot-instance-repository.js';
import { ScheduledTaskRecoveryRepository } from '../scheduled-task-recovery-repository.js';
import { UserRepository } from '../user-repository.js';
import { WorkspaceRepository } from '../workspace-repository.js';

const clients: Array<ReturnType<typeof createDatabaseClient>> = [];

afterEach(() => clients.splice(0).forEach((client) => client.close()));

describe('ScheduledTaskRecoveryRepository', () => {
  it('claims each recovery once and reports in-flight or delivered duplicates', async () => {
    const { client, recoveries } = await createFixture();
    const receivedAt = new Date('2026-08-31T10:00:00.000Z');
    const baseInput = {
      botInstanceId: 'bot_1',
      kind: 'missed_one_shot',
      prompt: 'remind the employee',
      scheduledFor: new Date('2026-08-29T06:00:00.000Z'),
      taskId: 'task_1',
    };

    await expect(recoveries.claim({
      ...baseInput,
      recoveryId: ' recovery-one ',
      receivedAt,
    })).resolves.toBe('claimed');
    await expect(recoveries.claim({
      ...baseInput,
      recoveryId: 'recovery-one',
      receivedAt: new Date(receivedAt.getTime() + 1_000),
      staleBefore: new Date(receivedAt.getTime() - 1),
    })).resolves.toBe('processing');

    expect(client.db.select().from(scheduledTaskRecoveries).all()).toEqual([
      expect.objectContaining({
        attemptCount: 1,
        botInstanceId: 'bot_1',
        kind: 'missed_one_shot',
        prompt: 'remind the employee',
        recoveryId: 'recovery-one',
        scheduledFor: baseInput.scheduledFor,
        status: 'delivering',
        taskId: 'task_1',
      }),
    ]);
    await expect(recoveries.claim({
      ...baseInput,
      recoveryId: '   ',
    })).rejects.toThrow('Recovery ID is required.');
  });

  it('marks deliveries succeeded or failed and never re-delivers succeeded ones', async () => {
    const { recoveries } = await createFixture();
    const deliveredAt = new Date('2026-08-31T10:05:00.000Z');
    const failedAt = new Date('2026-08-31T10:06:00.000Z');
    const baseInput = {
      botInstanceId: 'bot_1',
      kind: 'missed_one_shot',
      prompt: 'prompt',
      taskId: 'task_1',
    };

    await expect(recoveries.claim({ ...baseInput, recoveryId: 'success' })).resolves.toBe('claimed');
    await expect(recoveries.claim({ ...baseInput, recoveryId: 'failure' })).resolves.toBe('claimed');
    await recoveries.markDelivered('success', deliveredAt);
    await recoveries.markFailed('failure', `  ${'f'.repeat(1_100)}  `, failedAt);

    await expect(recoveries.claim({
      ...baseInput,
      recoveryId: 'success',
      staleBefore: deliveredAt,
    })).resolves.toBe('delivered');
    await expect(recoveries.claim({
      ...baseInput,
      recoveryId: 'failure',
      receivedAt: new Date(failedAt.getTime() + 1_000),
      staleBefore: failedAt,
    })).resolves.toBe('claimed');
    await expect(recoveries.claim({
      ...baseInput,
      recoveryId: 'failure',
      receivedAt: new Date(failedAt.getTime() + 1_000),
      staleBefore: new Date(failedAt.getTime() - 1),
    })).resolves.toBe('processing');
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
    recoveries: new ScheduledTaskRecoveryRepository(client.db),
  };
}
