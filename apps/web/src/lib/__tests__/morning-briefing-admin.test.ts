import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bulkUpdateAdminMorningBriefings,
  listAdminMorningBriefings,
  resolveMorningBriefingDeliveryStatus,
  resolveMorningBriefingScheduleStatus,
  updateAdminMorningBriefing,
} from '../morning-briefing-admin';

const bots = {
  findById: vi.fn(),
  listAllForAdministration: vi.fn(),
};
const policies = {
  bulkPatch: vi.fn(),
  ensureForBot: vi.fn(),
  findByBotId: vi.fn(),
  listAll: vi.fn(),
  patchForBot: vi.fn(),
};
const users = { findById: vi.fn() };
const repositories = {
  botInstances: bots,
  morningBriefingPolicies: policies,
  users,
};

beforeEach(() => {
  vi.clearAllMocks();
  bots.listAllForAdministration.mockResolvedValue([createBot()]);
  bots.findById.mockResolvedValue(createBot());
  policies.ensureForBot.mockResolvedValue(createPolicy());
  policies.patchForBot.mockResolvedValue(createPolicy());
  policies.bulkPatch.mockResolvedValue([createPolicy()]);
  users.findById.mockResolvedValue({ email: 'employee@example.com', id: 'user_1' });
});

describe('morning briefing admin service', () => {
  it('ensures every bot has a policy and returns operational summary data', async () => {
    const payload = await listAdminMorningBriefings(repositories as never);

    expect(policies.ensureForBot).toHaveBeenCalledWith('bot_1');
    expect(payload.summary).toEqual({ enabled: 0, needsAttention: 0, optedOut: 1, pending: 1, total: 1 });
    expect(payload.items[0]).toEqual(expect.objectContaining({
      botId: 'bot_1',
      botName: '微Link一号',
      ownerEmail: 'employee@example.com',
      runtimeStatus: 'running',
    }));
  });

  it('uses the persisted central schedule without requiring an Agent cron task', () => {
    const now = new Date('2026-07-24T09:00:00.000Z');
    const base = {
      adminEnabled: true,
      centralScheduledFor: '2026-07-27T00:30:00.000Z',
      forceEnabled: false,
      observedUserOptOut: false,
      runtimeNeedsCleanup: false,
      runtimeNeedsSchedule: false,
      runtimeObservedAt: now,
      runtimeScheduledFor: '2026-07-27T00:30:00.000Z',
      runtimeScheduleTaskId: 'cron_123',
    };

    expect(resolveMorningBriefingScheduleStatus(base, now)).toBe('scheduled');
    expect(resolveMorningBriefingScheduleStatus({
      ...base,
      centralScheduledFor: null,
    }, now)).toBe('setup-required');
    expect(resolveMorningBriefingScheduleStatus({
      ...base,
      centralScheduledFor: '2026-07-24T00:30:00.000Z',
    }, now)).toBe('scheduled');
  });

  it('distinguishes an unavailable Weixin conversation from a retryable failure', () => {
    expect(resolveMorningBriefingDeliveryStatus(null)).toBe('ready');
    expect(resolveMorningBriefingDeliveryStatus(
      'Weixin API request failed: 200 (ret=-2, errcode=n/a, prepare failed)',
    )).toBe('waiting-for-conversation');
    expect(resolveMorningBriefingDeliveryStatus(
      'Bot process is not running.',
    )).toBe('retrying');
  });

  it('validates and patches a single bot policy', async () => {
    await updateAdminMorningBriefing({
      botInstanceId: 'bot_1',
      payload: { deliveryTime: '09:10', forceEnabled: true, location: '泉州' },
      repositories: repositories as never,
    });

    expect(policies.patchForBot).toHaveBeenCalledWith('bot_1', {
      deliveryTime: '09:10',
      forceEnabled: true,
      location: '泉州',
    });
  });

  it('rejects malformed time values before writing', async () => {
    await expect(updateAdminMorningBriefing({
      botInstanceId: 'bot_1',
      payload: { deliveryTime: '25:99' },
      repositories: repositories as never,
    })).rejects.toMatchObject({ code: 'MORNING_BRIEFING_INVALID_POLICY', status: 400 });

    expect(policies.patchForBot).not.toHaveBeenCalled();
  });

  it('bulk patches only selected known bots', async () => {
    await bulkUpdateAdminMorningBriefings({
      payload: {
        botInstanceIds: ['bot_1'],
        patch: { adminEnabled: false },
        scope: 'selected',
      },
      repositories: repositories as never,
    });

    expect(policies.bulkPatch).toHaveBeenCalledWith(['bot_1'], { adminEnabled: false });
  });
});

function createBot() {
  return {
    id: 'bot_1',
    name: '微Link一号',
    ownerUserId: 'user_1',
    status: 'running',
  };
}

function createPolicy() {
  return {
    adminEnabled: true,
    appliedRevision: 1,
    botInstanceId: 'bot_1',
    centralLastDeliveredAt: null,
    centralLastDeliveryDate: null,
    centralLastError: null,
    centralScheduledFor: null,
    createdAt: new Date('2026-07-20T00:00:00.000Z'),
    deliveryTime: '08:30',
    desiredRevision: 2,
    forceEnabled: false,
    lastSyncError: null,
    lastSyncedAt: new Date('2026-07-20T01:00:00.000Z'),
    location: '北京',
    observedUserOptOut: true,
    runtimeNeedsCleanup: false,
    runtimeNeedsSchedule: false,
    runtimeObservedAt: new Date('2026-07-20T01:00:00.000Z'),
    runtimeScheduledFor: null,
    runtimeScheduleTaskId: null,
    syncStatus: 'pending',
    timezone: 'Asia/Shanghai',
    updatedAt: new Date('2026-07-20T01:00:00.000Z'),
  };
}
