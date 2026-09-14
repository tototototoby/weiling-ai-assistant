import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from './api-error';
import { getEnv } from './env';
import type { WebRepositories } from './repositories';

const globalConfigSchema = z.object({
  botId: z.string().trim().max(128),
  enabled: z.boolean(),
  secret: z.string().trim().max(2_000).optional(),
  wsUrl: z.string().trim().min(1).max(2_000),
}).strict();

const botBindingSchema = z.object({
  enabled: z.boolean(),
  preferredForProactive: z.boolean(),
  wecomUserId: z.string().trim().min(1).max(128),
}).strict();

const onboardingResetSchema = z.object({
  resetToken: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

type WecomBotBindingRepositories = Pick<
  WebRepositories,
  'botInstances' | 'botWecomBindings' | 'users'
>;

type WecomAdminRepositories = WecomBotBindingRepositories & Pick<
  WebRepositories,
  'globalWecomConfigs' | 'wecomOnboarding'
>;

export interface AdminWecomOnboardingSession {
  attemptCount: number;
  cooldownUntil: string | null;
  createdAt: string;
  expiresAt: string | null;
  maskedWecomUserId: string;
  resetToken: string;
  state: 'cooldown' | 'pending';
  updatedAt: string;
}

export interface AdminWecomBotBinding {
  botId: string;
  botName: string;
  bound: boolean;
  employeeId: string | null;
  employeeName: string | null;
  enabled: boolean;
  lastError: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  ownerEmail: string | null;
  ownerUserId: string;
  preferredForProactive: boolean;
  updatedAt: string | null;
  wecomUserId: string;
}

export interface AdminWecomPayload {
  bots: AdminWecomBotBinding[];
  config: {
    botId: string;
    connectionStatus: string;
    enabled: boolean;
    lastConnectedAt: string | null;
    lastDisconnectedAt: string | null;
    lastError: string | null;
    observedRevision: number | null;
    revision: number;
    secretConfigured: boolean;
    updatedAt: string;
    wsUrl: string;
  };
  onboardingSessions: AdminWecomOnboardingSession[];
  summary: {
    botCount: number;
    boundCount: number;
    cooldownOnboardingCount: number;
    enabledCount: number;
    errorCount: number;
    pendingOnboardingCount: number;
  };
}

export async function listAdminWecom(
  repositories: WecomAdminRepositories,
  options: { now?: Date; resetTokenSecret?: string } = {},
): Promise<AdminWecomPayload> {
  const now = options.now ?? new Date();
  const config = await repositories.globalWecomConfigs.ensure();
  const [bindings, bots, onboardingRecords] = await Promise.all([
    repositories.botWecomBindings.listAll(),
    repositories.botInstances.listAllForAdministration(),
    repositories.wecomOnboarding.listSessions(),
  ]);
  const bindingsByBotId = new Map(bindings.map((binding) => [binding.botInstanceId, binding]));
  const ownerIds = [...new Set(bots.map((bot) => bot.ownerUserId))];
  const owners = await Promise.all(ownerIds.map((ownerId) => repositories.users.findById(ownerId)));
  const ownersById = new Map(owners.filter(Boolean).map((owner) => [owner!.id, owner!]));
  const botItems = bots.map((bot) => mapBotBinding({
    binding: bindingsByBotId.get(bot.id),
    bot,
    ownerEmail: ownersById.get(bot.ownerUserId)?.email ?? null,
  }));
  const resetTokenSecret = options.resetTokenSecret
    ?? (onboardingRecords.length > 0 ? getEnv().BETTER_AUTH_SECRET : '');
  const onboardingSessions = onboardingRecords
    .filter((session) => session.status === 'awaiting_name')
    .map((session) => mapOnboardingSession(session, now, resetTokenSecret));

  return {
    bots: botItems,
    config: {
      botId: config.botId,
      connectionStatus: config.connectionStatus,
      enabled: config.enabled,
      lastConnectedAt: toIsoString(config.lastConnectedAt),
      lastDisconnectedAt: toIsoString(config.lastDisconnectedAt),
      lastError: config.lastError,
      observedRevision: config.observedRevision,
      revision: config.revision,
      secretConfigured: Boolean(config.secret),
      updatedAt: config.updatedAt.toISOString(),
      wsUrl: config.wsUrl,
    },
    onboardingSessions,
    summary: {
      botCount: botItems.length,
      boundCount: botItems.filter((item) => item.bound).length,
      cooldownOnboardingCount: onboardingSessions.filter((item) => item.state === 'cooldown').length,
      enabledCount: botItems.filter((item) => item.bound && item.enabled).length,
      errorCount: botItems.filter((item) => Boolean(item.lastError)).length,
      pendingOnboardingCount: onboardingSessions.filter((item) => item.state === 'pending').length,
    },
  };
}

export async function resetAdminWecomOnboardingSession(input: {
  payload: unknown;
  repositories: WecomAdminRepositories;
  resetTokenSecret?: string;
}): Promise<AdminWecomPayload> {
  const parsed = onboardingResetSchema.safeParse(input.payload);
  if (!parsed.success) throw invalidOnboardingResetError();
  const secret = input.resetTokenSecret ?? getEnv().BETTER_AUTH_SECRET;
  const sessions = await input.repositories.wecomOnboarding.listSessions();
  const session = sessions.find((candidate) => (
    candidate.status === 'awaiting_name'
    && resetTokensEqual(
      createOnboardingResetToken(candidate.wecomUserId, secret),
      parsed.data.resetToken,
    )
  ));
  if (!session) {
    throw new ApiError({
      code: 'WECOM_ONBOARDING_SESSION_NOT_FOUND',
      message: 'WeCom onboarding session does not exist.',
      status: 404,
    });
  }

  const deleted = await input.repositories.wecomOnboarding.deleteSession(session.wecomUserId);
  if (deleted === false) {
    throw new ApiError({
      code: 'WECOM_ONBOARDING_SESSION_NOT_FOUND',
      message: 'WeCom onboarding session does not exist.',
      status: 404,
    });
  }
  return listAdminWecom(input.repositories, { resetTokenSecret: secret });
}

export async function getAdminBotWecomBinding(
  botId: string,
  repositories: WecomBotBindingRepositories,
): Promise<AdminWecomBotBinding> {
  const bot = await repositories.botInstances.findById(botId);
  if (!bot) throw botNotFoundError();
  const [binding, owner] = await Promise.all([
    repositories.botWecomBindings.findByBotInstanceId(botId),
    repositories.users.findById(bot.ownerUserId),
  ]);
  return mapBotBinding({ binding: binding ?? undefined, bot, ownerEmail: owner?.email ?? null });
}

export async function updateAdminWecomConfig(input: {
  payload: unknown;
  repositories: WecomAdminRepositories;
  updatedByUserId: string;
}): Promise<AdminWecomPayload> {
  const parsed = globalConfigSchema.safeParse(input.payload);
  if (!parsed.success) throw invalidConfigError();

  await input.repositories.globalWecomConfigs.ensure();
  try {
    await input.repositories.globalWecomConfigs.update({
      ...parsed.data,
      updatedByUserId: input.updatedByUserId,
    });
  } catch (error) {
    throw invalidConfigError(error);
  }

  return listAdminWecom(input.repositories);
}

export async function requestAdminWecomReconnect(input: {
  repositories: WecomAdminRepositories;
  updatedByUserId: string;
}): Promise<AdminWecomPayload> {
  await input.repositories.globalWecomConfigs.ensure();
  try {
    await input.repositories.globalWecomConfigs.requestReconnect({
      updatedByUserId: input.updatedByUserId,
    });
  } catch (error) {
    throw new ApiError({
      code: 'WECOM_RECONNECT_NOT_AVAILABLE',
      message: error instanceof Error ? error.message : 'WeCom reconnect could not be requested.',
      status: 409,
    });
  }
  return listAdminWecom(input.repositories);
}

export async function updateAdminBotWecomBinding(input: {
  botId: string;
  payload: unknown;
  repositories: WecomBotBindingRepositories;
}): Promise<AdminWecomBotBinding> {
  const parsed = botBindingSchema.safeParse(input.payload);
  if (!parsed.success) throw invalidBindingError();
  if (!await input.repositories.botInstances.findById(input.botId)) throw botNotFoundError();

  try {
    await input.repositories.botWecomBindings.upsert({
      botInstanceId: input.botId,
      ...parsed.data,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ApiError({
        code: 'WECOM_USER_ID_CONFLICT',
        message: 'This WeCom user ID is already bound to another Bot.',
        status: 409,
      });
    }
    throw invalidBindingError(error);
  }

  return getAdminBotWecomBinding(input.botId, input.repositories);
}

export async function deleteAdminBotWecomBinding(input: {
  botId: string;
  repositories: WecomBotBindingRepositories;
}): Promise<AdminWecomBotBinding> {
  if (!await input.repositories.botInstances.findById(input.botId)) throw botNotFoundError();
  const deleted = await input.repositories.botWecomBindings.deleteByBotInstanceId(input.botId);
  if (!deleted) {
    throw new ApiError({
      code: 'WECOM_BINDING_NOT_FOUND',
      message: 'WeCom binding does not exist.',
      status: 404,
    });
  }
  return getAdminBotWecomBinding(input.botId, input.repositories);
}

function mapBotBinding(input: {
  binding?: {
    employeeId: string | null;
    enabled: boolean;
    lastError: string | null;
    lastInboundAt: Date | null;
    lastOutboundAt: Date | null;
    legalName: string | null;
    nickname: string | null;
    preferredForProactive: boolean;
    updatedAt: Date;
    wecomUserId: string;
  };
  bot: { id: string; name: string; ownerUserId: string };
  ownerEmail: string | null;
}): AdminWecomBotBinding {
  return {
    botId: input.bot.id,
    botName: input.bot.name,
    bound: Boolean(input.binding),
    employeeId: input.binding?.employeeId ?? null,
    employeeName: input.binding?.legalName ?? input.binding?.nickname ?? null,
    enabled: input.binding?.enabled ?? false,
    lastError: input.binding?.lastError ?? null,
    lastInboundAt: toIsoString(input.binding?.lastInboundAt),
    lastOutboundAt: toIsoString(input.binding?.lastOutboundAt),
    ownerEmail: input.ownerEmail,
    ownerUserId: input.bot.ownerUserId,
    preferredForProactive: input.binding?.preferredForProactive ?? true,
    updatedAt: toIsoString(input.binding?.updatedAt),
    wecomUserId: input.binding?.wecomUserId ?? '',
  };
}

function toIsoString(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

function mapOnboardingSession(
  session: {
    attemptCount: number;
    cooldownUntil?: Date | null;
    createdAt: Date;
    expiresAt?: Date | null;
    updatedAt: Date;
    wecomUserId: string;
  },
  now: Date,
  resetTokenSecret: string,
): AdminWecomOnboardingSession {
  const cooldownUntil = session.cooldownUntil ?? null;
  return {
    attemptCount: session.attemptCount,
    cooldownUntil: toIsoString(cooldownUntil),
    createdAt: session.createdAt.toISOString(),
    expiresAt: toIsoString(session.expiresAt),
    maskedWecomUserId: maskWecomUserId(session.wecomUserId),
    resetToken: createOnboardingResetToken(session.wecomUserId, resetTokenSecret),
    state: cooldownUntil && cooldownUntil.getTime() > now.getTime() ? 'cooldown' : 'pending',
    updatedAt: session.updatedAt.toISOString(),
  };
}

function maskWecomUserId(value: string): string {
  const normalized = value.trim();
  if (normalized.length <= 2) return '*';
  if (normalized.length <= 6) return `${normalized.slice(0, 1)}***${normalized.slice(-1)}`;
  return `${normalized.slice(0, 3)}***${normalized.slice(-2)}`;
}

function createOnboardingResetToken(wecomUserId: string, secret: string): string {
  return createHmac('sha256', secret)
    .update('weclaws:wecom-onboarding-reset:v1\0')
    .update(wecomUserId)
    .digest('hex');
}

function resetTokensEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = 'code' in error ? String(error.code) : '';
  return code.includes('SQLITE_CONSTRAINT_UNIQUE')
    || error.message.includes('bot_wecom_bindings.wecom_user_id');
}

function botNotFoundError(): ApiError {
  return new ApiError({ code: 'NOT_FOUND', message: 'Bot not found.', status: 404 });
}

function invalidConfigError(cause?: unknown): ApiError {
  return new ApiError({
    code: 'WECOM_INVALID_CONFIG',
    message: cause instanceof Error ? cause.message : 'Invalid WeCom configuration.',
    status: 400,
  });
}

function invalidBindingError(cause?: unknown): ApiError {
  return new ApiError({
    code: 'WECOM_INVALID_BINDING',
    message: cause instanceof Error ? cause.message : 'Invalid WeCom Bot binding.',
    status: 400,
  });
}

function invalidOnboardingResetError(): ApiError {
  return new ApiError({
    code: 'WECOM_ONBOARDING_RESET_INVALID',
    message: 'Select a valid WeCom onboarding session to reset.',
    status: 400,
  });
}
