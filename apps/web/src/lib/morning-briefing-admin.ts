import { z } from 'zod';
import { ApiError } from './api-error';
import type { WebRepositories } from './repositories';

const deliveryTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const locationSchema = z.string().trim().min(1).max(80);

const morningBriefingPatchSchema = z.object({
  adminEnabled: z.boolean().optional(),
  deliveryTime: deliveryTimeSchema.optional(),
  forceEnabled: z.boolean().optional(),
  location: locationSchema.optional(),
  timezone: z.literal('Asia/Shanghai').optional(),
}).strict().refine((payload) => Object.keys(payload).length > 0);

const morningBriefingBulkPatchSchema = z.object({
  botInstanceIds: z.array(z.string().trim().min(1)).min(1).optional(),
  patch: morningBriefingPatchSchema,
  scope: z.enum(['all', 'selected']),
}).strict().superRefine((payload, context) => {
  if (payload.scope === 'selected' && !payload.botInstanceIds?.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'botInstanceIds are required for selected scope.',
      path: ['botInstanceIds'],
    });
  }
});

export interface MorningBriefingPolicyRecordLike {
  adminEnabled: boolean;
  appliedRevision: number;
  botInstanceId: string;
  centralLastDeliveredAt: Date | string | null;
  centralLastDeliveryDate: string | null;
  centralLastError: string | null;
  centralScheduledFor: string | null;
  createdAt: Date | string;
  deliveryTime: string;
  desiredRevision: number;
  forceEnabled: boolean;
  lastSyncError: string | null;
  lastSyncedAt: Date | string | null;
  location: string;
  observedUserOptOut: boolean;
  runtimeNeedsCleanup: boolean;
  runtimeNeedsSchedule: boolean;
  runtimeObservedAt: Date | string | null;
  runtimeScheduledFor: string | null;
  runtimeScheduleTaskId: string | null;
  syncStatus: string;
  timezone: string;
  updatedAt: Date | string;
}

export interface MorningBriefingPolicyRepositoryLike {
  bulkPatch(
    botInstanceIds: readonly string[],
    patch: MorningBriefingPolicyPatch,
  ): Promise<MorningBriefingPolicyRecordLike[]>;
  ensureForBot(botInstanceId: string): Promise<MorningBriefingPolicyRecordLike>;
  findByBotId(botInstanceId: string): Promise<MorningBriefingPolicyRecordLike | null>;
  listAll(): Promise<MorningBriefingPolicyRecordLike[]>;
  patchForBot(
    botInstanceId: string,
    patch: MorningBriefingPolicyPatch,
  ): Promise<MorningBriefingPolicyRecordLike | null>;
}

type MorningBriefingAdminRepositories = {
  botInstances: Pick<WebRepositories['botInstances'], 'findById' | 'listAllForAdministration'>;
  morningBriefingPolicies: MorningBriefingPolicyRepositoryLike;
  users: Pick<WebRepositories['users'], 'findById'>;
};

export type MorningBriefingPolicyPatch = z.infer<typeof morningBriefingPatchSchema>;
export type MorningBriefingScheduleStatus =
  | 'cleanup-pending'
  | 'disabled'
  | 'scheduled'
  | 'setup-required'
  | 'stale'
  | 'unknown';
export type MorningBriefingDeliveryStatus =
  | 'ready'
  | 'retrying'
  | 'waiting-for-conversation';

export interface AdminMorningBriefingItem {
  adminEnabled: boolean;
  appliedRevision: number;
  botId: string;
  botName: string;
  centralLastDeliveredAt: string | null;
  centralLastDeliveryDate: string | null;
  centralLastError: string | null;
  centralScheduledFor: string | null;
  deliveryTime: string;
  desiredRevision: number;
  forceEnabled: boolean;
  lastSyncError: string | null;
  lastSyncedAt: string | null;
  location: string;
  observedUserOptOut: boolean;
  ownerEmail: string | null;
  runtimeNeedsCleanup: boolean;
  runtimeNeedsSchedule: boolean;
  runtimeObservedAt: string | null;
  runtimeScheduledFor: string | null;
  runtimeStatus: string;
  scheduleStatus: MorningBriefingScheduleStatus;
  syncStatus: string;
  timezone: string;
  updatedAt: string;
}

export interface AdminMorningBriefingPayload {
  items: AdminMorningBriefingItem[];
  summary: {
    enabled: number;
    needsAttention: number;
    optedOut: number;
    pending: number;
    total: number;
  };
}

export async function listAdminMorningBriefings(
  repositories: MorningBriefingAdminRepositories,
): Promise<AdminMorningBriefingPayload> {
  const bots = await repositories.botInstances.listAllForAdministration();
  const now = new Date();
  const items = await Promise.all(bots.map(async (bot) => {
    const [policy, owner] = await Promise.all([
      repositories.morningBriefingPolicies.ensureForBot(bot.id),
      repositories.users.findById(bot.ownerUserId),
    ]);

    return toAdminMorningBriefingItem(policy, {
      botName: bot.name,
      ownerEmail: owner?.email ?? null,
      runtimeStatus: bot.status,
    }, now);
  }));

  return toPayload(items);
}

export async function updateAdminMorningBriefing(input: {
  botInstanceId: string;
  payload: unknown;
  repositories: MorningBriefingAdminRepositories;
}): Promise<AdminMorningBriefingItem> {
  const patch = parsePatch(input.payload);
  const bot = await input.repositories.botInstances.findById(input.botInstanceId);

  if (!bot) {
    throw notFoundError();
  }

  await input.repositories.morningBriefingPolicies.ensureForBot(bot.id);
  const policy = await input.repositories.morningBriefingPolicies.patchForBot(bot.id, patch);

  if (!policy) {
    throw notFoundError();
  }

  const owner = await input.repositories.users.findById(bot.ownerUserId);
  return toAdminMorningBriefingItem(policy, {
    botName: bot.name,
    ownerEmail: owner?.email ?? null,
    runtimeStatus: bot.status,
  }, new Date());
}

export async function bulkUpdateAdminMorningBriefings(input: {
  payload: unknown;
  repositories: MorningBriefingAdminRepositories;
}): Promise<AdminMorningBriefingPayload> {
  const parsed = morningBriefingBulkPatchSchema.safeParse(input.payload);

  if (!parsed.success) {
    throw invalidPolicyError();
  }

  const allBots = await input.repositories.botInstances.listAllForAdministration();
  const targetIds = parsed.data.scope === 'all'
    ? allBots.map((bot) => bot.id)
    : parsed.data.botInstanceIds ?? [];
  const knownIds = new Set(allBots.map((bot) => bot.id));

  if (targetIds.some((botId) => !knownIds.has(botId))) {
    throw notFoundError();
  }

  await Promise.all(targetIds.map((botId) => input.repositories.morningBriefingPolicies.ensureForBot(botId)));
  await input.repositories.morningBriefingPolicies.bulkPatch(targetIds, parsed.data.patch);

  return listAdminMorningBriefings(input.repositories);
}

function parsePatch(payload: unknown): MorningBriefingPolicyPatch {
  const parsed = morningBriefingPatchSchema.safeParse(payload);

  if (!parsed.success) {
    throw invalidPolicyError();
  }

  return parsed.data;
}

function toPayload(items: AdminMorningBriefingItem[]): AdminMorningBriefingPayload {
  return {
    items,
    summary: {
      enabled: items.filter((item) => item.scheduleStatus === 'scheduled').length,
      needsAttention: items.filter((item) => (
        Boolean(item.centralLastError)
        || Boolean(item.lastSyncError)
        || item.scheduleStatus === 'cleanup-pending'
        || item.scheduleStatus === 'setup-required'
        || item.scheduleStatus === 'stale'
        || item.scheduleStatus === 'unknown'
      )).length,
      optedOut: items.filter((item) => item.observedUserOptOut).length,
      pending: items.filter(isPendingReconciliation).length,
      total: items.length,
    },
  };
}

function isPendingReconciliation(item: AdminMorningBriefingItem): boolean {
  return item.syncStatus !== 'synced' || item.desiredRevision !== item.appliedRevision;
}

function toAdminMorningBriefingItem(
  policy: MorningBriefingPolicyRecordLike,
  bot: { botName: string; ownerEmail: string | null; runtimeStatus: string },
  now: Date,
): AdminMorningBriefingItem {
  return {
    adminEnabled: policy.adminEnabled,
    appliedRevision: policy.appliedRevision,
    botId: policy.botInstanceId,
    botName: bot.botName,
    centralLastDeliveredAt: toIsoString(policy.centralLastDeliveredAt),
    centralLastDeliveryDate: policy.centralLastDeliveryDate,
    centralLastError: policy.centralLastError,
    centralScheduledFor: policy.centralScheduledFor,
    deliveryTime: policy.deliveryTime,
    desiredRevision: policy.desiredRevision,
    forceEnabled: policy.forceEnabled,
    lastSyncError: policy.lastSyncError,
    lastSyncedAt: toIsoString(policy.lastSyncedAt),
    location: policy.location,
    observedUserOptOut: policy.observedUserOptOut,
    ownerEmail: bot.ownerEmail,
    runtimeNeedsCleanup: policy.runtimeNeedsCleanup,
    runtimeNeedsSchedule: policy.runtimeNeedsSchedule,
    runtimeObservedAt: toIsoString(policy.runtimeObservedAt),
    runtimeScheduledFor: policy.runtimeScheduledFor,
    runtimeStatus: bot.runtimeStatus,
    scheduleStatus: resolveMorningBriefingScheduleStatus(policy, now),
    syncStatus: policy.syncStatus,
    timezone: policy.timezone,
    updatedAt: toIsoString(policy.updatedAt)!,
  };
}

export function resolveMorningBriefingScheduleStatus(
  policy: Pick<
    MorningBriefingPolicyRecordLike,
    | 'adminEnabled'
    | 'centralScheduledFor'
    | 'forceEnabled'
    | 'observedUserOptOut'
  >,
  _now: Date = new Date(),
): MorningBriefingScheduleStatus {
  const effectiveEnabled = policy.adminEnabled
    && (!policy.observedUserOptOut || policy.forceEnabled);

  if (!effectiveEnabled) {
    return 'disabled';
  }

  if (!policy.centralScheduledFor) {
    return 'setup-required';
  }

  const scheduledAt = Date.parse(policy.centralScheduledFor);

  if (!Number.isFinite(scheduledAt)) {
    return 'setup-required';
  }

  return 'scheduled';
}

export function resolveMorningBriefingDeliveryStatus(
  error: string | null,
): MorningBriefingDeliveryStatus {
  if (!error) return 'ready';
  if (
    /ret=-2/i.test(error)
    || /prepare failed/i.test(error)
    || /exactly one active binding, found 0/i.test(error)
    || /weixin account .* is not configured/i.test(error)
    || /context[_ ]token/i.test(error)
  ) {
    return 'waiting-for-conversation';
  }
  return 'retrying';
}

function toIsoString(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function invalidPolicyError(): ApiError {
  return new ApiError({
    code: 'MORNING_BRIEFING_INVALID_POLICY',
    message: 'Invalid morning briefing policy.',
    status: 400,
  });
}

function notFoundError(): ApiError {
  return new ApiError({
    code: 'MORNING_BRIEFING_BOT_NOT_FOUND',
    message: 'Bot not found.',
    status: 404,
  });
}
