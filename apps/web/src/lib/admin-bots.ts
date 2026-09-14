import type { BotDesiredState, BotStatus } from '@weiling-ai/shared';
import { ApiError } from './api-error';
import type { BotDetailItem, BotEventItem } from './bot-service';
import { getBotDetail, listBotEvents } from './bot-service';
import {
  resolveMorningBriefingScheduleStatus,
  type AdminMorningBriefingItem,
} from './morning-briefing-admin';
import { getAdminBotAgentConfig, type AdminBotAgentConfigPayload } from './admin-bot-agent-config';
import { getAdminBotWecomBinding, type AdminWecomBotBinding } from './wecom-admin';
import type { WebRepositories } from './repositories';

type AdminBotRepositories = Pick<
  WebRepositories,
  | 'botAgentConfigOverrides'
  | 'botAgentConfigSyncStates'
  | 'botInstances'
  | 'botWecomBindings'
  | 'globalAgentConfigs'
  | 'globalWecomConfigs'
  | 'morningBriefingPolicies'
  | 'users'
>;

export interface AdminBotItem {
  createdAt: string;
  desiredState: BotDesiredState;
  id: string;
  model: string;
  morningBriefing: Pick<
    AdminMorningBriefingItem,
    | 'adminEnabled'
    | 'appliedRevision'
    | 'centralLastDeliveredAt'
    | 'centralLastDeliveryDate'
    | 'centralLastError'
    | 'centralScheduledFor'
    | 'deliveryTime'
    | 'desiredRevision'
    | 'forceEnabled'
    | 'lastSyncError'
    | 'lastSyncedAt'
    | 'location'
    | 'observedUserOptOut'
    | 'runtimeNeedsCleanup'
    | 'runtimeNeedsSchedule'
    | 'runtimeObservedAt'
    | 'runtimeScheduledFor'
    | 'scheduleStatus'
    | 'syncStatus'
    | 'timezone'
  >;
  name: string;
  ownerEmail: string | null;
  ownerUserId: string;
  provider: string;
  status: BotStatus;
  updatedAt: string;
}

export interface AdminBotsPayload {
  items: AdminBotItem[];
  summary: {
    briefingEnabled: number;
    pendingReconciliation: number;
    running: number;
    total: number;
    unhealthy: number;
  };
}

export interface AdminBotDetailPayload {
  agentConfig: AdminBotAgentConfigPayload;
  bot: BotDetailItem;
  events: BotEventItem[];
  inventory: AdminBotItem;
  wecomBinding: AdminWecomBotBinding;
}

export async function listAdminBots(repositories: AdminBotRepositories): Promise<AdminBotsPayload> {
  const bots = await repositories.botInstances.listAllForAdministration();
  const items = await Promise.all(bots.map(async (bot) => {
    const [owner, policy] = await Promise.all([
      repositories.users.findById(bot.ownerUserId),
      repositories.morningBriefingPolicies.ensureForBot(bot.id),
    ]);

    return {
      createdAt: bot.createdAt.toISOString(),
      desiredState: bot.desiredState,
      id: bot.id,
      model: bot.model,
      morningBriefing: {
        adminEnabled: policy.adminEnabled,
        appliedRevision: policy.appliedRevision,
        centralLastDeliveredAt: policy.centralLastDeliveredAt?.toISOString() ?? null,
        centralLastDeliveryDate: policy.centralLastDeliveryDate,
        centralLastError: policy.centralLastError,
        centralScheduledFor: policy.centralScheduledFor,
        deliveryTime: policy.deliveryTime,
        desiredRevision: policy.desiredRevision,
        forceEnabled: policy.forceEnabled,
        lastSyncError: policy.lastSyncError,
        lastSyncedAt: policy.lastSyncedAt?.toISOString() ?? null,
        location: policy.location,
        observedUserOptOut: policy.observedUserOptOut,
        runtimeNeedsCleanup: policy.runtimeNeedsCleanup,
        runtimeNeedsSchedule: policy.runtimeNeedsSchedule,
        runtimeObservedAt: policy.runtimeObservedAt?.toISOString() ?? null,
        runtimeScheduledFor: policy.runtimeScheduledFor,
        scheduleStatus: resolveMorningBriefingScheduleStatus(policy),
        syncStatus: policy.syncStatus,
        timezone: policy.timezone,
      },
      name: bot.name,
      ownerEmail: owner?.email ?? null,
      ownerUserId: bot.ownerUserId,
      provider: bot.provider,
      status: bot.status,
      updatedAt: bot.updatedAt.toISOString(),
    } satisfies AdminBotItem;
  }));

  return {
    items,
    summary: {
      briefingEnabled: items.filter((item) => (
        item.morningBriefing.scheduleStatus === 'scheduled'
      )).length,
      pendingReconciliation: items.filter((item) => (
        item.morningBriefing.syncStatus !== 'synced'
        || item.morningBriefing.desiredRevision !== item.morningBriefing.appliedRevision
        || Boolean(item.morningBriefing.centralLastError)
        || item.morningBriefing.scheduleStatus === 'cleanup-pending'
        || item.morningBriefing.scheduleStatus === 'setup-required'
        || item.morningBriefing.scheduleStatus === 'stale'
        || item.morningBriefing.scheduleStatus === 'unknown'
      )).length,
      running: items.filter((item) => item.status === 'running').length,
      total: items.length,
      unhealthy: items.filter((item) => item.status === 'failed' || item.status === 'degraded').length,
    },
  };
}

export async function getAdminBotDetail(
  botId: string,
  repositories: AdminBotRepositories,
): Promise<AdminBotDetailPayload> {
  const payload = await listAdminBots(repositories);
  const inventory = payload.items.find((item) => item.id === botId);

  if (!inventory) {
    throw new ApiError({ code: 'NOT_FOUND', message: 'Bot not found.', status: 404 });
  }

  const [agentConfig, bot, events, wecomBinding] = await Promise.all([
    getAdminBotAgentConfig(botId, repositories),
    getBotDetail(botId),
    listBotEvents(botId),
    getAdminBotWecomBinding(botId, repositories),
  ]);

  return { agentConfig, bot, events, inventory, wecomBinding };
}
