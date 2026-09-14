import {
  AdminMessageDeliveryRepository,
  BotInstanceRepository,
  DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY,
  EmailDeliveryRepository,
  EmployeeDirectoryRepository,
  EmployeeInviteLinkRepository,
  GlobalAdminMessageConfigRepository,
  GlobalEmailConfigRepository,
  GLOBAL_ADMIN_MESSAGE_COPY_KEYS,
  UserRepository,
  WorkspaceRepository,
  createDatabaseClient,
  migrateDatabase,
} from '@weiling-ai/db';
import { afterEach, describe, expect, it } from 'vitest';
import { ADMIN_MESSAGE_COPY_DEFAULTS, ADMIN_MESSAGE_COPY_KEYS } from '../admin-message-copy';
import {
  createAdminMessageBatch,
  listAdminMessages,
  updateAdminMessageConfig,
} from '../admin-messages';

const clients: Array<ReturnType<typeof createDatabaseClient>> = [];

afterEach(() => {
  clients.splice(0).forEach((client) => client.close());
});

describe('administrator message service', () => {
  it('keeps the browser-safe copy contract aligned with the database contract', () => {
    expect([...ADMIN_MESSAGE_COPY_KEYS].sort()).toEqual([...GLOBAL_ADMIN_MESSAGE_COPY_KEYS].sort());
    expect(ADMIN_MESSAGE_COPY_DEFAULTS).toEqual(DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY);
  });

  it('returns the default failed-message policy with targets and deliveries', async () => {
    const repositories = await createRepositories();
    await repositories.adminMessageDeliveries.createBatch([{
      batchId: 'batch_1',
      botInstanceId: 'bot_1',
      createdByUserId: 'user_1',
      id: 'delivery_1',
      message: 'Company notice',
      recipientUserId: 'user_1',
    }], new Date('2026-07-27T01:00:00.000Z'));

    const payload = await listAdminMessages(repositories);

    expect(payload.config).toMatchObject({
      ...ADMIN_MESSAGE_COPY_DEFAULTS,
      deferFailedUntilUserActive: true,
    });
    expect(payload.targets).toEqual([
      expect.objectContaining({ botId: 'bot_1', botName: 'Bot One', ownerEmail: 'admin@example.com' }),
    ]);
    expect(payload.deliveries).toEqual([
      expect.objectContaining({ botId: 'bot_1', message: 'Company notice', status: 'pending' }),
    ]);
  });

  it('updates the durable failed-message policy', async () => {
    const repositories = await createRepositories();

    const copy = {
      ...ADMIN_MESSAGE_COPY_DEFAULTS,
      assistantName: '微Link · 微灵 AI 助手管理台',
    };
    const payload = await updateAdminMessageConfig({
      payload: { deferFailedUntilUserActive: false, ...copy },
      repositories,
    });

    expect(payload.config).toMatchObject({ deferFailedUntilUserActive: false, ...copy });
    await expect(repositories.globalAdminMessageConfigs.find()).resolves.toMatchObject({
      assistantName: copy.assistantName,
      deferFailedUntilUserActive: false,
    });
  });

  it('returns a controlled validation error for an invalid policy update', async () => {
    const repositories = await createRepositories();

    await expect(updateAdminMessageConfig({
      payload: { deferFailedUntilUserActive: 'yes', ...ADMIN_MESSAGE_COPY_DEFAULTS },
      repositories,
    })).rejects.toMatchObject({
      code: 'ADMIN_MESSAGE_CONFIG_INVALID',
      status: 400,
    });
  });

  it('rejects blank, oversized, control-character, and invalid-template message copy', async () => {
    const repositories = await createRepositories();

    await expect(updateAdminMessageConfig({
      payload: {
        deferFailedUntilUserActive: true,
        ...ADMIN_MESSAGE_COPY_DEFAULTS,
        mealRainReminder: '   ',
      },
      repositories,
    })).rejects.toMatchObject({ code: 'ADMIN_MESSAGE_CONFIG_INVALID', status: 400 });

    await expect(updateAdminMessageConfig({
      payload: {
        deferFailedUntilUserActive: true,
        ...ADMIN_MESSAGE_COPY_DEFAULTS,
        mealRainReminder: '收到\n处理中',
      },
      repositories,
    })).rejects.toMatchObject({ code: 'ADMIN_MESSAGE_CONFIG_INVALID', status: 400 });

    await expect(updateAdminMessageConfig({
      payload: {
        deferFailedUntilUserActive: true,
        ...ADMIN_MESSAGE_COPY_DEFAULTS,
        mealRainReminder: 'x'.repeat(4_001),
      },
      repositories,
    })).rejects.toMatchObject({ code: 'ADMIN_MESSAGE_CONFIG_INVALID', status: 400 });

    await expect(updateAdminMessageConfig({
      payload: {
        deferFailedUntilUserActive: true,
        ...ADMIN_MESSAGE_COPY_DEFAULTS,
        mealRainReminder: 'Hi {{unknown}}',
      },
      repositories,
    })).rejects.toMatchObject({ code: 'ADMIN_MESSAGE_CONFIG_INVALID', status: 400 });

    await expect(updateAdminMessageConfig({
      payload: {
        deferFailedUntilUserActive: true,
        ...ADMIN_MESSAGE_COPY_DEFAULTS,
        mealRainReminder: 'Hi {{ assistantName }}',
      },
      repositories,
    })).rejects.toMatchObject({ code: 'ADMIN_MESSAGE_CONFIG_INVALID', status: 400 });

    await expect(updateAdminMessageConfig({
      payload: {
        deferFailedUntilUserActive: true,
        ...ADMIN_MESSAGE_COPY_DEFAULTS,
        mealRainReminder: 'Hi {{assistantName',
      },
      repositories,
    })).rejects.toMatchObject({ code: 'ADMIN_MESSAGE_CONFIG_INVALID', status: 400 });
  });

  it('uses character limits that match the database contract', async () => {
    const repositories = await createRepositories();

    await expect(updateAdminMessageConfig({
      payload: {
        deferFailedUntilUserActive: true,
        ...ADMIN_MESSAGE_COPY_DEFAULTS,
        mealRainReminder: '高'.repeat(4_000),
      },
      repositories,
    })).resolves.toMatchObject({
      config: { mealRainReminder: '高'.repeat(4_000) },
    });

    await expect(updateAdminMessageConfig({
      payload: {
        deferFailedUntilUserActive: true,
        ...ADMIN_MESSAGE_COPY_DEFAULTS,
        assistantName: '高'.repeat(81),
      },
      repositories,
    })).rejects.toMatchObject({ code: 'ADMIN_MESSAGE_CONFIG_INVALID', status: 400 });
  });

  it('serializes exhausted deferred deliveries as waiting for the user', async () => {
    const repositories = await createRepositories();
    const now = new Date('2026-07-27T01:00:00.000Z');
    await repositories.adminMessageDeliveries.createBatch([{
      batchId: 'batch_1',
      botInstanceId: 'bot_1',
      createdByUserId: 'user_1',
      id: 'delivery_1',
      message: 'Company notice',
      recipientUserId: 'user_1',
    }], now);
    await repositories.adminMessageDeliveries.claimReady({ now });
    await repositories.adminMessageDeliveries.markAttemptFailed({
      deferAfterMaxAttempts: true,
      error: 'No active conversation',
      id: 'delivery_1',
      maxAttempts: 1,
      nextAttemptAt: new Date(now.getTime() + 5_000),
      updatedAt: now,
    });

    await expect(listAdminMessages(repositories)).resolves.toMatchObject({
      deliveries: [{
        lastError: 'No active conversation',
        status: 'waiting_for_user',
      }],
    });
  });

  it('queues both IM and email deliveries for a claimed employee', async () => {
    const repositories = await createRepositories();

    const payload = await createAdminMessageBatch({
      createdByUserId: 'user_1',
      payload: {
        botInstanceIds: ['bot_1'],
        channel: 'both',
        message: 'Company notice',
        scope: 'selected',
        subject: 'Important notice',
      },
      repositories,
    });

    await expect(repositories.adminMessageDeliveries.listRecent()).resolves.toEqual([
      expect.objectContaining({ botInstanceId: 'bot_1', message: 'Company notice' }),
    ]);
    await expect(repositories.emailDeliveries.listRecent()).resolves.toEqual([
      expect.objectContaining({
        botInstanceId: 'bot_1',
        message: 'Company notice',
        recipientEmail: 'admin@example.com',
        recipientUserId: 'user_1',
        source: 'admin',
        subject: 'Important notice',
      }),
    ]);
    expect(payload.emailDeliveries).toEqual([
      expect.objectContaining({ botId: 'bot_1', recipientEmail: 'admin@example.com' }),
    ]);
  });

  it('rejects email delivery when a selected employee has no company email', async () => {
    const repositories = await createRepositories();
    await repositories.employeeDirectory.updateCompanyEmail('employee_1', null);

    await expect(createAdminMessageBatch({
      createdByUserId: 'user_1',
      payload: {
        botInstanceIds: ['bot_1'],
        channel: 'email',
        message: 'Company notice',
        scope: 'selected',
      },
      repositories,
    })).rejects.toMatchObject({ code: 'EMAIL_RECIPIENT_MISSING', status: 400 });
    await expect(repositories.emailDeliveries.listRecent()).resolves.toEqual([]);
  });
});

async function createRepositories() {
  const client = createDatabaseClient({ url: ':memory:' });
  clients.push(client);
  migrateDatabase(client);

  const users = new UserRepository(client.db);
  const workspaces = new WorkspaceRepository(client.db);
  const botInstances = new BotInstanceRepository(client.db);
  await users.create({ email: 'admin@example.com', id: 'user_1', name: 'Admin' });
  await workspaces.create({ id: 'workspace_1', name: 'One', ownerUserId: 'user_1' });
  await botInstances.create({
    desiredState: 'running',
    id: 'bot_1',
    model: 'test',
    name: 'Bot One',
    ownerUserId: 'user_1',
    provider: 'openai',
    status: 'running',
    workspaceId: 'workspace_1',
  });

  const employeeInviteLinks = new EmployeeInviteLinkRepository(client.db);
  const employeeDirectory = new EmployeeDirectoryRepository(client.db);
  await employeeInviteLinks.create({
    createdByUserId: 'user_1',
    id: 'employee_invite_1',
    token: 'employee-invite-token',
  });
  await employeeDirectory.create({
    companyEmail: 'admin@example.com',
    id: 'employee_1',
    legalName: 'Admin',
    nickname: null,
    normalizedLegalName: 'admin',
    normalizedNickname: null,
  });
  await employeeDirectory.reserveByInviteAndName({
    inviteToken: 'employee-invite-token',
    normalizedName: 'admin',
    reservationToken: 'employee-reservation-token',
    staleBefore: new Date(0),
  });
  await employeeDirectory.claimReservationWithoutUser('employee-reservation-token', 'bot_1');

  return {
    adminMessageDeliveries: new AdminMessageDeliveryRepository(client.db),
    botInstances,
    emailDeliveries: new EmailDeliveryRepository(client.db),
    employeeDirectory,
    globalAdminMessageConfigs: new GlobalAdminMessageConfigRepository(client.db),
    globalEmailConfigs: new GlobalEmailConfigRepository(client.db),
    users,
  };
}
