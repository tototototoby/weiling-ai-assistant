import { z } from 'zod';
import { ApiError } from './api-error';
import type { WebRepositories } from './repositories';

const botConfigSchema = z.object({
  appId: z.string().trim().min(1).max(128),
  appSecret: z.string().trim().min(1).max(2_000),
  enabled: z.boolean().default(true),
}).strict();

const disableSchema = z.object({
  enabled: z.literal(false),
}).strict();

type FeishuAdminRepositories = Pick<
  WebRepositories,
  'botFeishuConfigs' | 'botInstances' | 'users'
>;

export interface AdminFeishuBotConfig {
  appIdConfigured: boolean;
  botId: string;
  botName: string;
  enabled: boolean;
  eventStatus: string;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastError: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  ownerOpenId: string | null;
  ownerEmail: string | null;
  ownerUserId: string;
  revision: number;
  secretConfigured: boolean;
  updatedAt: string | null;
}

export interface AdminFeishuPayload {
  bots: AdminFeishuBotConfig[];
  summary: {
    botCount: number;
    configuredCount: number;
    disabledCount: number;
    enabledCount: number;
    connectedCount: number;
    errorCount: number;
  };
}

export async function listAdminFeishu(
  repositories: FeishuAdminRepositories,
): Promise<AdminFeishuPayload> {
  const [bots, configs] = await Promise.all([
    repositories.botInstances.listAllForAdministration(),
    repositories.botFeishuConfigs.listAll(),
  ]);
  const configsByBotId = new Map(configs.map((config) => [config.botInstanceId, config]));
  const ownerIds = [...new Set(bots.map((bot) => bot.ownerUserId))];
  const owners = await Promise.all(ownerIds.map((ownerId) => repositories.users.findById(ownerId)));
  const ownersById = new Map(owners.filter(Boolean).map((owner) => [owner!.id, owner!]));
  const items = bots.map((bot) => mapBotConfig({
    bot,
    config: configsByBotId.get(bot.id) ?? null,
    ownerEmail: ownersById.get(bot.ownerUserId)?.email ?? null,
  }));

  return {
    bots: items,
    summary: {
      botCount: items.length,
      configuredCount: items.filter((item) => item.appIdConfigured).length,
      disabledCount: items.filter((item) => item.appIdConfigured && !item.enabled).length,
      enabledCount: items.filter((item) => item.enabled).length,
      connectedCount: items.filter((item) => item.eventStatus === 'connected').length,
      errorCount: items.filter((item) => Boolean(item.lastError)).length,
    },
  };
}

export async function getAdminBotFeishuConfig(
  botId: string,
  repositories: FeishuAdminRepositories,
): Promise<AdminFeishuBotConfig> {
  const bot = await repositories.botInstances.findById(botId);
  if (!bot) throw botNotFoundError();
  const [config, owner] = await Promise.all([
    repositories.botFeishuConfigs.findByBotInstanceId(botId),
    repositories.users.findById(bot.ownerUserId),
  ]);
  return mapBotConfig({
    bot,
    config: config ?? null,
    ownerEmail: owner?.email ?? null,
  });
}

export async function updateAdminBotFeishuConfig(input: {
  botId: string;
  payload: unknown;
  repositories: FeishuAdminRepositories;
  updatedByUserId: string;
}): Promise<AdminFeishuBotConfig> {
  if (!await input.repositories.botInstances.findById(input.botId)) throw botNotFoundError();

  const disable = disableSchema.safeParse(input.payload);
  if (disable.success) {
    await input.repositories.botFeishuConfigs.ensure(input.botId);
    try {
      await input.repositories.botFeishuConfigs.disable({
        botInstanceId: input.botId,
        updatedByUserId: input.updatedByUserId,
      });
    } catch (error) {
      throw invalidConfigError(error);
    }
    return getAdminBotFeishuConfig(input.botId, input.repositories);
  }

  const parsed = botConfigSchema.safeParse(input.payload);
  if (!parsed.success) throw invalidConfigError();

  await input.repositories.botFeishuConfigs.ensure(input.botId);
  try {
    await input.repositories.botFeishuConfigs.update({
      appId: parsed.data.appId,
      appSecret: parsed.data.appSecret,
      botInstanceId: input.botId,
      enabled: parsed.data.enabled,
      updatedByUserId: input.updatedByUserId,
    });
  } catch (error) {
    throw invalidConfigError(error);
  }
  return getAdminBotFeishuConfig(input.botId, input.repositories);
}

export async function deleteAdminBotFeishuConfig(input: {
  botId: string;
  repositories: FeishuAdminRepositories;
  updatedByUserId: string;
}): Promise<AdminFeishuBotConfig> {
  if (!await input.repositories.botInstances.findById(input.botId)) throw botNotFoundError();
  await input.repositories.botFeishuConfigs.ensure(input.botId);
  try {
    await input.repositories.botFeishuConfigs.clearCredentials({
      botInstanceId: input.botId,
      updatedByUserId: input.updatedByUserId,
    });
  } catch (error) {
    throw invalidConfigError(error);
  }
  return getAdminBotFeishuConfig(input.botId, input.repositories);
}

function mapBotConfig(input: {
  bot: { id: string; name: string; ownerUserId: string };
  config: {
    appId: string;
    appSecret: string;
    enabled: boolean;
    eventStatus: string;
    lastConnectedAt: Date | null;
    lastDisconnectedAt: Date | null;
    lastError: string | null;
    lastInboundAt: Date | null;
    lastOutboundAt: Date | null;
    ownerOpenId?: string | null;
    revision: number;
    updatedAt: Date;
  } | null;
  ownerEmail: string | null;
}): AdminFeishuBotConfig {
  return {
    appIdConfigured: Boolean(input.config?.appId),
    botId: input.bot.id,
    botName: input.bot.name,
    enabled: input.config?.enabled ?? false,
    eventStatus: input.config?.eventStatus ?? 'not_configured',
    lastConnectedAt: toIsoString(input.config?.lastConnectedAt),
    lastDisconnectedAt: toIsoString(input.config?.lastDisconnectedAt),
    lastError: input.config?.lastError ?? null,
    lastInboundAt: toIsoString(input.config?.lastInboundAt),
    lastOutboundAt: toIsoString(input.config?.lastOutboundAt),
    ownerOpenId: maskOpenId(input.config?.ownerOpenId ?? null),
    ownerEmail: input.ownerEmail,
    ownerUserId: input.bot.ownerUserId,
    revision: input.config?.revision ?? 0,
    secretConfigured: Boolean(input.config?.appSecret),
    updatedAt: input.config ? input.config.updatedAt.toISOString() : null,
  };
}

function toIsoString(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

function maskOpenId(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 8) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function botNotFoundError(): ApiError {
  return new ApiError({ code: 'NOT_FOUND', message: 'Bot not found.', status: 404 });
}

function invalidConfigError(cause?: unknown): ApiError {
  return new ApiError({
    code: 'FEISHU_INVALID_CONFIG',
    message: cause instanceof Error ? cause.message : 'Invalid Feishu Bot configuration.',
    status: 400,
  });
}
