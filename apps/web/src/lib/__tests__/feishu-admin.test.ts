import { describe, expect, it } from 'vitest';
import {
  deleteAdminBotFeishuConfig,
  getAdminBotFeishuConfig,
  listAdminFeishu,
  updateAdminBotFeishuConfig,
} from '../feishu-admin';

interface FakeConfig {
  appId: string;
  appSecret: string;
  botInstanceId: string;
  enabled: boolean;
  eventStatus: string;
  lastConnectedAt: Date | null;
  lastDisconnectedAt: Date | null;
  lastError: string | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  revision: number;
  updatedAt: Date;
  updatedByUserId: string | null;
}

function createFixture(input: { configured?: boolean } = {}) {
  const bots = [
    { id: 'bot_1', name: 'Bot 1', ownerUserId: 'admin_1' },
    { id: 'bot_2', name: 'Bot 2', ownerUserId: 'admin_2' },
  ];
  const configs = new Map<string, FakeConfig>();
  if (input.configured) {
    configs.set('bot_1', {
      appId: 'cli_app-one',
      appSecret: 'secret-one',
      botInstanceId: 'bot_1',
      enabled: true,
      eventStatus: 'connected',
      lastConnectedAt: new Date('2026-08-31T10:00:00.000Z'),
      lastDisconnectedAt: null,
      lastError: null,
      lastInboundAt: null,
      lastOutboundAt: null,
      revision: 2,
      updatedAt: new Date('2026-08-31T10:00:00.000Z'),
      updatedByUserId: 'admin_1',
    });
  }

  return {
    repositories: {
      botFeishuConfigs: {
        clearCredentials: async (input: { botInstanceId: string; updatedByUserId?: string | null }) => {
          const current = configs.get(input.botInstanceId);
          if (!current) throw new Error('not initialized');
          const next: FakeConfig = {
            ...current,
            appId: '',
            appSecret: '',
            enabled: false,
            eventStatus: 'not_configured',
            lastError: null,
            revision: current.revision + 1,
            updatedAt: new Date('2026-08-31T11:00:00.000Z'),
            updatedByUserId: input.updatedByUserId ?? null,
          };
          configs.set(input.botInstanceId, next);
          return next;
        },
        disable: async (input: { botInstanceId: string; updatedByUserId?: string | null }) => {
          const current = configs.get(input.botInstanceId);
          if (!current) throw new Error('not initialized');
          const next: FakeConfig = {
            ...current,
            enabled: false,
            eventStatus: 'disabled',
            revision: current.revision + 1,
            updatedAt: new Date('2026-08-31T11:00:00.000Z'),
            updatedByUserId: input.updatedByUserId ?? null,
          };
          configs.set(input.botInstanceId, next);
          return next;
        },
        ensure: async (botInstanceId: string) => {
          if (!configs.has(botInstanceId)) {
            configs.set(botInstanceId, {
              appId: '',
              appSecret: '',
              botInstanceId,
              enabled: false,
              eventStatus: 'not_configured',
              lastConnectedAt: null,
              lastDisconnectedAt: null,
              lastError: null,
              lastInboundAt: null,
              lastOutboundAt: null,
              revision: 1,
              updatedAt: new Date(),
              updatedByUserId: null,
            });
          }
          return configs.get(botInstanceId)!;
        },
        findByBotInstanceId: async (botInstanceId: string) => configs.get(botInstanceId) ?? null,
        listAll: async () => [...configs.values()],
        update: async (input: {
          appId: string;
          appSecret: string;
          botInstanceId: string;
          enabled: boolean;
          updatedByUserId?: string | null;
        }) => {
          const current = configs.get(input.botInstanceId) ?? {
            appId: '',
            appSecret: '',
            botInstanceId: input.botInstanceId,
            enabled: false,
            eventStatus: 'not_configured',
            lastConnectedAt: null,
            lastDisconnectedAt: null,
            lastError: null,
            lastInboundAt: null,
            lastOutboundAt: null,
            revision: 0,
            updatedAt: new Date(),
            updatedByUserId: null,
          };
          const next: FakeConfig = {
            ...current,
            appId: input.appId,
            appSecret: input.appSecret,
            enabled: input.enabled,
            eventStatus: input.enabled ? 'connecting' : 'disabled',
            lastError: null,
            revision: current.revision + 1,
            updatedAt: new Date('2026-08-31T11:00:00.000Z'),
            updatedByUserId: input.updatedByUserId ?? null,
          };
          configs.set(input.botInstanceId, next);
          return next;
        },
      },
      botInstances: {
        findById: async (botId: string) => bots.find((bot) => bot.id === botId) ?? null,
        listAllForAdministration: async () => bots,
      },
      users: {
        findById: async (userId: string) => ({
          email: `${userId}@example.com`,
          id: userId,
        }),
      },
    },
  };
}

describe('listAdminFeishu', () => {
  it('maps every Bot with an unconfigured default', async () => {
    const { repositories } = createFixture();
    const payload = await listAdminFeishu(repositories as never);

    expect(payload.bots).toHaveLength(2);
    expect(payload.bots[0]).toMatchObject({
      appIdConfigured: false,
      botId: 'bot_1',
      botName: 'Bot 1',
      enabled: false,
      eventStatus: 'not_configured',
      ownerEmail: 'admin_1@example.com',
      ownerUserId: 'admin_1',
      secretConfigured: false,
    });
    expect(payload.summary).toEqual({
      botCount: 2,
      configuredCount: 0,
      disabledCount: 0,
      enabledCount: 0,
      connectedCount: 0,
      errorCount: 0,
    });
  });

  it('summarizes configured, connected, disabled, and error states', async () => {
    const { repositories } = createFixture({ configured: true });
    const payload = await listAdminFeishu(repositories as never);

    expect(payload.bots[0]).toMatchObject({
      appIdConfigured: true,
      enabled: true,
      eventStatus: 'connected',
      lastConnectedAt: '2026-08-31T10:00:00.000Z',
      revision: 2,
      secretConfigured: true,
    });
    expect(payload.summary).toEqual({
      botCount: 2,
      configuredCount: 1,
      disabledCount: 0,
      enabledCount: 1,
      connectedCount: 1,
      errorCount: 0,
    });
  });
});

describe('updateAdminBotFeishuConfig', () => {
  it('enables a Bot with credentials and records the admin as updater', async () => {
    const { repositories } = createFixture();
    const result = await updateAdminBotFeishuConfig({
      botId: 'bot_1',
      payload: { appId: 'cli_app-one', appSecret: 'secret-one', enabled: true },
      repositories: repositories as never,
      updatedByUserId: 'admin_1',
    });

    expect(result).toMatchObject({
      appIdConfigured: true,
      botId: 'bot_1',
      enabled: true,
      eventStatus: 'connecting',
      revision: 2,
      secretConfigured: true,
    });
  });

  it('disables a configured Bot without clearing credentials', async () => {
    const { repositories } = createFixture({ configured: true });
    const result = await updateAdminBotFeishuConfig({
      botId: 'bot_1',
      payload: { enabled: false },
      repositories: repositories as never,
      updatedByUserId: 'admin_1',
    });

    expect(result).toMatchObject({
      appIdConfigured: true,
      enabled: false,
      eventStatus: 'disabled',
      secretConfigured: true,
    });
  });

  it('rejects malformed payloads', async () => {
    const { repositories } = createFixture();
    await expect(updateAdminBotFeishuConfig({
      botId: 'bot_1',
      payload: { appId: 'x' },
      repositories: repositories as never,
      updatedByUserId: 'admin_1',
    })).rejects.toMatchObject({ code: 'FEISHU_INVALID_CONFIG' });
  });
});

describe('deleteAdminBotFeishuConfig', () => {
  it('clears credentials and marks the Bot unconfigured', async () => {
    const { repositories } = createFixture({ configured: true });
    const result = await deleteAdminBotFeishuConfig({
      botId: 'bot_1',
      repositories: repositories as never,
      updatedByUserId: 'admin_1',
    });

    expect(result).toMatchObject({
      appIdConfigured: false,
      enabled: false,
      eventStatus: 'not_configured',
      secretConfigured: false,
    });
  });

  it('fails for missing Bots', async () => {
    const { repositories } = createFixture();
    await expect(getAdminBotFeishuConfig('missing', repositories as never))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
