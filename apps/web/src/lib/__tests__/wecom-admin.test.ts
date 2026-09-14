import {
  BotInstanceRepository,
  BotWecomBindingRepository,
  GlobalWecomConfigRepository,
  UserRepository,
  WecomOnboardingRepository,
  WorkspaceRepository,
  createDatabaseClient,
  migrateDatabase,
} from '@weiling-ai/db';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteAdminBotWecomBinding,
  getAdminBotWecomBinding,
  listAdminWecom,
  requestAdminWecomReconnect,
  resetAdminWecomOnboardingSession,
  updateAdminBotWecomBinding,
  updateAdminWecomConfig,
} from '../wecom-admin';

const clients: Array<ReturnType<typeof createDatabaseClient>> = [];

afterEach(() => {
  clients.splice(0).forEach((client) => client.close());
});

describe('WeCom admin service', () => {
  it('increments the global revision without exposing the stored Secret', async () => {
    const repositories = await createRepositories();

    const payload = await updateAdminWecomConfig({
      payload: {
        botId: 'wecom_bot_1',
        enabled: true,
        secret: 'server-only-secret',
        wsUrl: 'wss://openws.work.weixin.qq.com',
      },
      repositories,
      updatedByUserId: 'user_1',
    });

    expect(payload.config).toMatchObject({
      botId: 'wecom_bot_1',
      connectionStatus: 'connecting',
      enabled: true,
      revision: 2,
      secretConfigured: true,
      wsUrl: 'wss://openws.work.weixin.qq.com',
    });
    expect(payload.config).not.toHaveProperty('secret');
    expect(JSON.stringify(payload)).not.toContain('server-only-secret');
  });

  it('binds WeCom directly to a Bot when the employee directory is empty', async () => {
    const repositories = await createRepositories();

    await expect(listAdminWecom(repositories)).resolves.toMatchObject({
      bots: [expect.objectContaining({ botId: 'bot_1', bound: false })],
      summary: { botCount: 1, boundCount: 0, enabledCount: 0 },
    });

    const binding = await updateAdminBotWecomBinding({
      botId: 'bot_1',
      payload: {
        enabled: true,
        preferredForProactive: true,
        wecomUserId: 'zhangting',
      },
      repositories,
    });

    expect(binding).toMatchObject({
      botId: 'bot_1',
      botName: 'Bot One',
      bound: true,
      employeeId: null,
      employeeName: null,
      enabled: true,
      preferredForProactive: true,
      wecomUserId: 'zhangting',
    });
    await expect(listAdminWecom(repositories)).resolves.toMatchObject({
      summary: { botCount: 1, boundCount: 1, enabledCount: 1 },
    });
  });

  it('rejects one WeCom user ID being bound to two Bots', async () => {
    const repositories = await createRepositories({ withSecondBot: true });
    const payload = {
      enabled: true,
      preferredForProactive: true,
      wecomUserId: 'shared-user',
    };

    await updateAdminBotWecomBinding({ botId: 'bot_1', payload, repositories });
    await expect(updateAdminBotWecomBinding({
      botId: 'bot_2',
      payload,
      repositories,
    })).rejects.toMatchObject({ code: 'WECOM_USER_ID_CONFLICT', status: 409 });
  });

  it('unbinds only the selected Bot channel', async () => {
    const repositories = await createRepositories();
    await updateAdminBotWecomBinding({
      botId: 'bot_1',
      payload: {
        enabled: true,
        preferredForProactive: false,
        wecomUserId: 'zhangting',
      },
      repositories,
    });

    const unbound = await deleteAdminBotWecomBinding({ botId: 'bot_1', repositories });

    expect(unbound).toMatchObject({ botId: 'bot_1', bound: false, wecomUserId: '' });
    await expect(getAdminBotWecomBinding('bot_1', repositories)).resolves.toEqual(unbound);
  });

  it('preserves the stored Secret when the update omits it', async () => {
    const repositories = await createRepositories();
    await updateAdminWecomConfig({
      payload: {
        botId: 'wecom_bot_1',
        enabled: true,
        secret: 'server-only-secret',
        wsUrl: 'wss://openws.work.weixin.qq.com',
      },
      repositories,
      updatedByUserId: 'user_1',
    });

    const payload = await updateAdminWecomConfig({
      payload: {
        botId: 'wecom_bot_2',
        enabled: true,
        wsUrl: 'wss://openws.work.weixin.qq.com',
      },
      repositories,
      updatedByUserId: 'user_1',
    });

    expect(payload.config).toMatchObject({ revision: 3, secretConfigured: true });
    await expect(listAdminWecom(repositories)).resolves.toMatchObject({
      config: { secretConfigured: true },
    });
  });

  it('increments the revision when a reconnect is requested', async () => {
    const repositories = await createRepositories();
    await updateAdminWecomConfig({
      payload: {
        botId: 'wecom_bot_1',
        enabled: true,
        secret: 'server-only-secret',
        wsUrl: 'wss://openws.work.weixin.qq.com',
      },
      repositories,
      updatedByUserId: 'user_1',
    });

    const payload = await requestAdminWecomReconnect({
      repositories,
      updatedByUserId: 'user_1',
    });

    expect(payload.config).toMatchObject({
      connectionStatus: 'connecting',
      observedRevision: null,
      revision: 3,
    });
  });

  it('lists pending and cooldown onboarding sessions without exposing WeCom user IDs', async () => {
    const repositories = await createRepositories();
    const now = new Date('2026-07-28T08:00:00.000Z');
    await repositories.wecomOnboarding.beginOrGetSession({ now, wecomUserId: 'pending-employee-001' });
    await repositories.wecomOnboarding.beginOrGetSession({ now, wecomUserId: 'x' });
    await repositories.wecomOnboarding.beginOrGetSession({ now, wecomUserId: 'abc' });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await repositories.wecomOnboarding.recordFailedAttempt({
        now: new Date(now.getTime() + attempt + 1),
        wecomUserId: 'cooldown-employee-002',
      });
    }

    const payload = await listAdminWecom(repositories, {
      now: new Date(now.getTime() + 10),
      resetTokenSecret: 'test-reset-secret',
    });

    expect(payload.summary).toMatchObject({
      cooldownOnboardingCount: 1,
      pendingOnboardingCount: 3,
    });
    expect(payload.onboardingSessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ maskedWecomUserId: 'pen***01', state: 'pending' }),
      expect.objectContaining({ maskedWecomUserId: 'coo***02', state: 'cooldown' }),
      expect.objectContaining({ maskedWecomUserId: '*', state: 'pending' }),
      expect.objectContaining({ maskedWecomUserId: 'a***c', state: 'pending' }),
    ]));
    expect(payload.onboardingSessions.every((session) => /^[a-f0-9]{64}$/u.test(session.resetToken))).toBe(true);
    expect(JSON.stringify(payload)).not.toContain('pending-employee-001');
    expect(JSON.stringify(payload)).not.toContain('cooldown-employee-002');
  });

  it('resets only the pending onboarding session selected by its opaque HMAC token', async () => {
    const repositories = await createRepositories();
    await repositories.wecomOnboarding.beginOrGetSession({ wecomUserId: 'pending-employee-001' });
    const listed = await listAdminWecom(repositories, { resetTokenSecret: 'test-reset-secret' });

    const payload = await resetAdminWecomOnboardingSession({
      payload: { resetToken: listed.onboardingSessions[0].resetToken },
      repositories,
      resetTokenSecret: 'test-reset-secret',
    });

    expect(payload.onboardingSessions).toEqual([]);
    await expect(repositories.wecomOnboarding.listSessions()).resolves.toEqual([]);
  });
});

async function createRepositories(input: { withSecondBot?: boolean } = {}) {
  const client = createDatabaseClient({ url: ':memory:' });
  clients.push(client);
  migrateDatabase(client);

  const users = new UserRepository(client.db);
  const workspaces = new WorkspaceRepository(client.db);
  const botInstances = new BotInstanceRepository(client.db);

  await users.create({ email: 'admin@example.com', id: 'user_1', name: 'Admin' });
  await workspaces.create({ id: 'ws_1', name: 'One', ownerUserId: 'user_1' });
  await botInstances.create({
    desiredState: 'running',
    id: 'bot_1',
    model: 'test',
    name: 'Bot One',
    ownerUserId: 'user_1',
    provider: 'openai',
    status: 'running',
    workspaceId: 'ws_1',
  });

  if (input.withSecondBot) {
    await workspaces.create({ id: 'ws_2', name: 'Two', ownerUserId: 'user_1' });
    await botInstances.create({
      desiredState: 'running',
      id: 'bot_2',
      model: 'test',
      name: 'Bot Two',
      ownerUserId: 'user_1',
      provider: 'openai',
      status: 'running',
      workspaceId: 'ws_2',
    });
  }

  return {
    botInstances,
    botWecomBindings: new BotWecomBindingRepository(client.db),
    globalWecomConfigs: new GlobalWecomConfigRepository(client.db),
    users,
    wecomOnboarding: new WecomOnboardingRepository(client.db),
  };
}
