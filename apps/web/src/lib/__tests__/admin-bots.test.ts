import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listAdminBots } from '../admin-bots';

const botInstances = { listAllForAdministration: vi.fn() };
const botAgentConfigOverrides = { findByBotId: vi.fn(), listRevisions: vi.fn() };
const botAgentConfigSyncStates = { ensureForBot: vi.fn() };
const globalAgentConfigs = { getSnapshot: vi.fn() };
const morningBriefingPolicies = { ensureForBot: vi.fn() };
const users = { findById: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  botInstances.listAllForAdministration.mockResolvedValue([{
    createdAt: new Date('2026-07-20T00:00:00.000Z'),
    desiredState: 'running',
    id: 'bot_1',
    model: 'Qwen3.7 Plus',
    name: '微Link一号',
    ownerUserId: 'user_1',
    provider: 'opencode',
    status: 'degraded',
    updatedAt: new Date('2026-07-20T01:00:00.000Z'),
  }]);
  morningBriefingPolicies.ensureForBot.mockResolvedValue({
    adminEnabled: true,
    appliedRevision: 1,
    centralLastDeliveredAt: null,
    centralLastDeliveryDate: null,
    centralLastError: null,
    centralScheduledFor: '2027-07-27T00:30:00.000Z',
    deliveryTime: '08:30',
    desiredRevision: 2,
    forceEnabled: false,
    lastSyncError: null,
    lastSyncedAt: null,
    location: '北京',
    observedUserOptOut: false,
    runtimeNeedsCleanup: false,
    runtimeNeedsSchedule: false,
    runtimeObservedAt: new Date('2026-07-20T01:00:00.000Z'),
    runtimeScheduledFor: '2027-07-27T00:30:00.000Z',
    runtimeScheduleTaskId: 'cron_123',
    syncStatus: 'pending',
    timezone: 'Asia/Shanghai',
  });
  users.findById.mockResolvedValue({ email: 'employee@example.com', id: 'user_1' });
  botAgentConfigOverrides.findByBotId.mockResolvedValue(null);
  botAgentConfigOverrides.listRevisions.mockResolvedValue([]);
  botAgentConfigSyncStates.ensureForBot.mockResolvedValue({
    appliedOverrideRevision: 0,
    appliedRevision: 1,
    lastSyncError: null,
    lastSyncedAt: null,
    syncStatus: 'synced',
  });
  globalAgentConfigs.getSnapshot.mockResolvedValue({ config: { revision: 1 } });
});

describe('admin bot inventory', () => {
  it('joins all bots with owner and morning briefing convergence', async () => {
    const result = await listAdminBots({
      botAgentConfigOverrides,
      botAgentConfigSyncStates,
      botInstances,
      globalAgentConfigs,
      morningBriefingPolicies,
      users,
    } as never);

    expect(result.summary).toEqual({
      briefingEnabled: 1,
      pendingReconciliation: 1,
      running: 0,
      total: 1,
      unhealthy: 1,
    });
    expect(result.items[0]).toEqual(expect.objectContaining({
      id: 'bot_1',
      ownerEmail: 'employee@example.com',
      morningBriefing: expect.objectContaining({ desiredRevision: 2, appliedRevision: 1 }),
    }));
  });
});
