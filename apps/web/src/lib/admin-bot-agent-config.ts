import { z } from 'zod';
import { ApiError } from './api-error';
import type { WebRepositories } from './repositories';

const updateSchema = z.object({
  agentsAppendix: z.string().max(200_000),
  changeReason: z.string().trim().min(1).max(500),
  soulAppendix: z.string().max(200_000),
}).strict();

const restoreSchema = z.object({
  changeReason: z.string().trim().min(1).max(500),
  revision: z.number().int().positive(),
}).strict();

type Repositories = Pick<
  WebRepositories,
  'botAgentConfigOverrides' | 'botAgentConfigSyncStates' | 'botInstances' | 'globalAgentConfigs'
>;

export interface AdminBotAgentConfigPayload {
  globalRevision: number;
  history: Array<{
    agentsAppendix: string;
    changeReason: string;
    createdAt: string;
    revision: number;
    soulAppendix: string;
    updatedByEmail: string;
  }>;
  override: {
    active: boolean;
    agentsAppendix: string;
    changeReason: string | null;
    revision: number;
    soulAppendix: string;
    updatedAt: string | null;
    updatedByEmail: string | null;
  };
  projection: {
    appliedGlobalRevision: number;
    appliedOverrideRevision: number;
    lastSyncError: string | null;
    lastSyncedAt: string | null;
    syncStatus: string;
  };
}

export async function getAdminBotAgentConfig(
  botInstanceId: string,
  repositories: Repositories,
): Promise<AdminBotAgentConfigPayload> {
  await requireBot(botInstanceId, repositories);
  const [global, override, history, projection] = await Promise.all([
    repositories.globalAgentConfigs.getSnapshot(),
    repositories.botAgentConfigOverrides.findByBotId(botInstanceId),
    repositories.botAgentConfigOverrides.listRevisions(botInstanceId),
    repositories.botAgentConfigSyncStates.ensureForBot(botInstanceId),
  ]);

  if (!global) {
    throw new ApiError({
      code: 'GLOBAL_AGENT_CONFIG_NOT_INITIALIZED',
      message: 'Global Agent configuration is not initialized.',
      status: 409,
    });
  }

  return {
    globalRevision: global.config.revision,
    history: history.map((item) => ({
      agentsAppendix: item.agentsAppendix,
      changeReason: item.changeReason,
      createdAt: item.createdAt.toISOString(),
      revision: item.revision,
      soulAppendix: item.soulAppendix,
      updatedByEmail: item.updatedByEmail,
    })),
    override: {
      active: Boolean(override?.agentsAppendix || override?.soulAppendix),
      agentsAppendix: override?.agentsAppendix ?? '',
      changeReason: override?.changeReason ?? null,
      revision: override?.revision ?? 0,
      soulAppendix: override?.soulAppendix ?? '',
      updatedAt: override?.updatedAt.toISOString() ?? null,
      updatedByEmail: override?.updatedByEmail ?? null,
    },
    projection: {
      appliedGlobalRevision: projection.appliedRevision,
      appliedOverrideRevision: projection.appliedOverrideRevision,
      lastSyncError: projection.lastSyncError,
      lastSyncedAt: projection.lastSyncedAt?.toISOString() ?? null,
      syncStatus: projection.syncStatus,
    },
  };
}

export async function updateAdminBotAgentConfig(input: {
  administratorEmail: string;
  botInstanceId: string;
  payload: unknown;
  repositories: Repositories;
}): Promise<AdminBotAgentConfigPayload> {
  const parsed = updateSchema.safeParse(input.payload);
  if (!parsed.success) throw invalidConfigError();
  await requireBot(input.botInstanceId, input.repositories);
  await input.repositories.botAgentConfigOverrides.update(input.botInstanceId, {
    ...parsed.data,
    updatedByEmail: input.administratorEmail,
  });
  await input.repositories.botAgentConfigSyncStates.markPendingForBot(input.botInstanceId);
  return getAdminBotAgentConfig(input.botInstanceId, input.repositories);
}

export async function restoreAdminBotAgentConfig(input: {
  administratorEmail: string;
  botInstanceId: string;
  payload: unknown;
  repositories: Repositories;
}): Promise<AdminBotAgentConfigPayload> {
  const parsed = restoreSchema.safeParse(input.payload);
  if (!parsed.success) throw invalidConfigError();
  await requireBot(input.botInstanceId, input.repositories);
  const restored = await input.repositories.botAgentConfigOverrides.restoreRevision(
    input.botInstanceId,
    parsed.data.revision,
    {
      changeReason: parsed.data.changeReason,
      updatedByEmail: input.administratorEmail,
    },
  );
  if (!restored) {
    throw new ApiError({
      code: 'BOT_AGENT_OVERRIDE_REVISION_NOT_FOUND',
      message: 'Bot Agent override revision not found.',
      status: 404,
    });
  }
  await input.repositories.botAgentConfigSyncStates.markPendingForBot(input.botInstanceId);
  return getAdminBotAgentConfig(input.botInstanceId, input.repositories);
}

async function requireBot(botInstanceId: string, repositories: Repositories) {
  const bot = await repositories.botInstances.findById(botInstanceId);
  if (!bot) throw new ApiError({ code: 'NOT_FOUND', message: 'Bot not found.', status: 404 });
  return bot;
}

function invalidConfigError() {
  return new ApiError({
    code: 'BOT_AGENT_OVERRIDE_INVALID_CONFIG',
    message: 'Invalid Bot Agent override configuration.',
    status: 400,
  });
}
