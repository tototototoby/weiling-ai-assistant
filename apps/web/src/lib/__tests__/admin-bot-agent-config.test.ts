import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAdminBotAgentConfig,
  restoreAdminBotAgentConfig,
  updateAdminBotAgentConfig,
} from '../admin-bot-agent-config';

const botAgentConfigOverrides = {
  findByBotId: vi.fn(),
  listRevisions: vi.fn(),
  restoreRevision: vi.fn(),
  update: vi.fn(),
};
const botAgentConfigSyncStates = {
  ensureForBot: vi.fn(),
  markPendingForBot: vi.fn(),
};
const botInstances = { findById: vi.fn() };
const globalAgentConfigs = { getSnapshot: vi.fn() };
const repositories = {
  botAgentConfigOverrides,
  botAgentConfigSyncStates,
  botInstances,
  globalAgentConfigs,
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  botInstances.findById.mockResolvedValue({ id: 'bot_1' });
  globalAgentConfigs.getSnapshot.mockResolvedValue({ config: { revision: 7 } });
  botAgentConfigOverrides.findByBotId.mockResolvedValue(null);
  botAgentConfigOverrides.listRevisions.mockResolvedValue([]);
  botAgentConfigSyncStates.ensureForBot.mockResolvedValue({
    appliedOverrideRevision: 0,
    appliedRevision: 7,
    lastSyncError: null,
    lastSyncedAt: null,
    syncStatus: 'synced',
  });
});

describe('per-Bot Agent configuration administration', () => {
  it('rejects an unknown Bot before reading or changing its configuration', async () => {
    botInstances.findById.mockResolvedValue(null);

    await expect(getAdminBotAgentConfig('missing_bot', repositories)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    expect(botAgentConfigOverrides.findByBotId).not.toHaveBeenCalled();
  });

  it('updates only the requested Bot and marks only that Bot pending', async () => {
    botAgentConfigOverrides.update.mockResolvedValue({ revision: 1 });

    await updateAdminBotAgentConfig({
      administratorEmail: 'admin@example.com',
      botInstanceId: 'bot_1',
      payload: {
        agentsAppendix: 'Always include the source.',
        changeReason: 'Support request 42',
        soulAppendix: 'Use concise language.',
      },
      repositories,
    });

    expect(botAgentConfigOverrides.update).toHaveBeenCalledWith('bot_1', {
      agentsAppendix: 'Always include the source.',
      changeReason: 'Support request 42',
      soulAppendix: 'Use concise language.',
      updatedByEmail: 'admin@example.com',
    });
    expect(botAgentConfigSyncStates.markPendingForBot).toHaveBeenCalledWith('bot_1');
  });

  it('returns 404 and does not mark pending when a historical revision is missing', async () => {
    botAgentConfigOverrides.restoreRevision.mockResolvedValue(null);

    await expect(restoreAdminBotAgentConfig({
      administratorEmail: 'admin@example.com',
      botInstanceId: 'bot_1',
      payload: { changeReason: 'Restore requested by owner', revision: 99 },
      repositories,
    })).rejects.toMatchObject({
      code: 'BOT_AGENT_OVERRIDE_REVISION_NOT_FOUND',
      status: 404,
    });
    expect(botAgentConfigSyncStates.markPendingForBot).not.toHaveBeenCalled();
  });
});
