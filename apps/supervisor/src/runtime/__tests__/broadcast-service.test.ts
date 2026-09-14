import { describe, expect, it, vi } from 'vitest';
import {
  BroadcastError,
  BroadcastService,
  type BroadcastServiceDependencies,
} from '../broadcast-service';

describe('BroadcastService', () => {
  it('rejects empty, whitespace-only, and oversized text', async () => {
    const harness = createService();

    await expect(harness.service.sendBroadcast({
      botInstanceId: 'bot_1',
      scope: 'all',
      text: '',
    })).rejects.toMatchObject({ code: 'INVALID_TEXT' });
    await expect(harness.service.sendBroadcast({
      botInstanceId: 'bot_1',
      scope: 'all',
      text: '   ',
    })).rejects.toMatchObject({ code: 'INVALID_TEXT' });
    await expect(harness.service.sendBroadcast({
      botInstanceId: 'bot_1',
      scope: 'all',
      text: 'a'.repeat(64 * 1024 + 1),
    })).rejects.toMatchObject({ code: 'INVALID_TEXT' });
  });

  it('rejects a Bot that is not bound to an employee', async () => {
    const harness = createService({
      employeeDirectory: {
        findClaimedByBotInstanceId: vi.fn().mockResolvedValue(null),
        listAll: vi.fn().mockResolvedValue([]),
      },
    });

    await expect(harness.service.sendBroadcast({
      botInstanceId: 'bot_1',
      scope: 'all',
      text: 'hello',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('broadcasts to group members except the leader and does not require global config', async () => {
    const harness = createService({
      employeeGroups: {
        listByLeaderEmployeeId: vi.fn().mockResolvedValue([{ id: 'group_1' }]),
        listMemberEntries: vi.fn(async (groupId: string) => {
          if (groupId !== 'group_1') {
            return [];
          }
          return [
            createEmployee({ id: 'leader', claimedBotInstanceId: 'bot_1' }),
            createEmployee({ id: 'member_1', claimedBotInstanceId: 'bot_2' }),
            createEmployee({ id: 'member_2', claimedBotInstanceId: 'bot_3' }),
            createEmployee({ id: 'member_3', claimedBotInstanceId: null }),
          ];
        }),
      },
    });

    const result = await harness.service.sendBroadcast({
      botInstanceId: 'bot_1',
      scope: 'group',
      text: '  group notice  ',
    });

    expect(result).toEqual({
      accepted: true,
      deliveryCount: 2,
      deliveryIds: expect.any(Array),
    });
    const rows = (harness.deliveries.createBatch.mock.calls[0]?.[0] ?? []) as Array<{
      batchId: string;
      botInstanceId: string;
      createdByUserId: string;
      id: string;
      message: string;
      recipientUserId: string;
      metadata: string;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      batchId: expect.stringMatching(/^scheduled:broadcast:bot_1:\d+$/),
      botInstanceId: 'bot_2',
      createdByUserId: 'user_1',
      id: expect.stringMatching(/^broadcast:bot_1:\d+:0$/),
      message: 'group notice',
      recipientUserId: 'user_2',
    });
    expect(JSON.parse(String(rows[0].metadata))).toMatchObject({
      broadcast: true,
      scope: 'group',
      senderBotInstanceId: 'bot_1',
      senderEmployeeId: 'leader',
    });
    expect(harness.config.ensure).not.toHaveBeenCalled();
  });

  it('rejects non-leaders and returns accepted false when a group has no bound targets', async () => {
    const notLeader = createService({
      employeeDirectory: {
        findClaimedByBotInstanceId: vi.fn().mockResolvedValue(createEmployee({
          id: 'worker',
          claimedBotInstanceId: 'bot_1',
        })),
        listAll: vi.fn().mockResolvedValue([]),
      },
      employeeGroups: {
        listByLeaderEmployeeId: vi.fn().mockResolvedValue([]),
        listMemberEntries: vi.fn().mockResolvedValue([]),
      },
    });
    await expect(notLeader.service.sendBroadcast({
      botInstanceId: 'bot_1',
      scope: 'group',
      text: 'hello',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const emptyGroup = createService({
      employeeGroups: {
        listByLeaderEmployeeId: vi.fn().mockResolvedValue([{ id: 'group_1' }]),
        listMemberEntries: vi.fn().mockResolvedValue([
          createEmployee({ id: 'leader', claimedBotInstanceId: 'bot_1' }),
        ]),
      },
    });
    await expect(emptyGroup.service.sendBroadcast({
      botInstanceId: 'bot_1',
      scope: 'group',
      text: 'hello',
    })).resolves.toEqual({ accepted: false, deliveryCount: 0, deliveryIds: [] });
    expect(emptyGroup.deliveries.createBatch).not.toHaveBeenCalled();
  });

  it('enforces global authorization for all and selected broadcasts', async () => {
    const disabled = createService({
      globalBroadcastConfig: {
        ensure: vi.fn().mockResolvedValue({
          authorizedEmployeeIdsJson: '["leader"]',
          enabled: false,
          rateLimitMinutes: 10,
        }),
      },
    });
    await expect(disabled.service.sendBroadcast({
      botInstanceId: 'bot_1',
      scope: 'all',
      text: 'hello',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const unauthorized = createService({
      globalBroadcastConfig: {
        ensure: vi.fn().mockResolvedValue({
          authorizedEmployeeIdsJson: '["someone_else"]',
          enabled: true,
          rateLimitMinutes: 10,
        }),
      },
    });
    await expect(unauthorized.service.sendBroadcast({
      botInstanceId: 'bot_1',
      scope: 'selected',
      targetBotInstanceIds: ['bot_2'],
      text: 'hello',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const missingTargets = createService();
    await expect(missingTargets.service.sendBroadcast({
      botInstanceId: 'bot_1',
      scope: 'selected',
      text: 'hello',
    })).rejects.toMatchObject({ code: 'INVALID_TEXT' });
  });

  it('resolves all and selected targets through the employee directory and Bot owners', async () => {
    const allHarness = createService({
      employeeDirectory: {
        findClaimedByBotInstanceId: vi.fn().mockResolvedValue(createEmployee({
          id: 'leader',
          claimedBotInstanceId: 'bot_1',
        })),
        listAll: vi.fn().mockResolvedValue([
          createEmployee({ id: 'a', claimedBotInstanceId: 'bot_2' }),
          createEmployee({ id: 'b', claimedBotInstanceId: 'bot_3' }),
          createEmployee({ id: 'c', claimedBotInstanceId: null }),
        ]),
      },
    });
    await allHarness.service.sendBroadcast({
      botInstanceId: 'bot_1',
      scope: 'all',
      text: 'all notice',
    });
    expect(allHarness.deliveries.createBatch.mock.calls[0]?.[0]).toHaveLength(2);

    const selectedHarness = createService();
    const selectedResult = await selectedHarness.service.sendBroadcast({
      botInstanceId: 'bot_1',
      scope: 'selected',
      targetBotInstanceIds: ['bot_2', 'bot_3'],
      text: 'selected notice',
    });
    expect(selectedResult).toEqual({
      accepted: true,
      deliveryCount: 2,
      deliveryIds: expect.any(Array),
    });
    const selectedRows = (selectedHarness.deliveries.createBatch.mock.calls[0]?.[0] ?? []) as Array<{
      botInstanceId: string;
    }>;
    expect(selectedRows.map((row) => row.botInstanceId)).toEqual(['bot_2', 'bot_3']);
  });

  it('rate limits by Bot instance and resets after the configured window', async () => {
    let now = new Date('2026-08-24T00:00:00.000Z');
    const harness = createService({ now: () => now });

    await harness.service.sendBroadcast({
      botInstanceId: 'bot_1',
      scope: 'selected',
      targetBotInstanceIds: ['bot_2'],
      text: 'first',
    });

    await expect(harness.service.sendBroadcast({
      botInstanceId: 'bot_1',
      scope: 'selected',
      targetBotInstanceIds: ['bot_2'],
      text: 'second',
    })).rejects.toBeInstanceOf(BroadcastError);
    await expect(harness.service.sendBroadcast({
      botInstanceId: 'bot_1',
      scope: 'selected',
      targetBotInstanceIds: ['bot_2'],
      text: 'second',
    })).rejects.toMatchObject({ code: 'RATE_LIMITED' });

    now = new Date('2026-08-24T00:10:00.000Z');
    await expect(harness.service.sendBroadcast({
      botInstanceId: 'bot_1',
      scope: 'selected',
      targetBotInstanceIds: ['bot_2'],
      text: 'third',
    })).resolves.toMatchObject({ accepted: true, deliveryCount: 1 });
  });
});

type BroadcastServiceDependencyOverrides = {
  [Key in keyof BroadcastServiceDependencies]?: unknown;
};

function createService(overrides: BroadcastServiceDependencyOverrides = {}) {
  const config = {
    ensure: vi.fn().mockResolvedValue({
      authorizedEmployeeIdsJson: '["leader"]',
      enabled: true,
      rateLimitMinutes: 10,
    }),
  };
  const botInstances = {
    findById: vi.fn(async (botInstanceId: string) => ({
      id: botInstanceId,
      ownerUserId: botInstanceId === 'bot_1' ? 'user_1' : `user_${botInstanceId.slice(-1)}`,
    })),
  };
  const employeeDirectory = {
    findClaimedByBotInstanceId: vi.fn().mockResolvedValue(createEmployee({
      id: 'leader',
      claimedBotInstanceId: 'bot_1',
    })),
    listAll: vi.fn().mockResolvedValue([]),
  };
  const employeeGroups = {
    listByLeaderEmployeeId: vi.fn().mockResolvedValue([]),
    listMemberEntries: vi.fn().mockResolvedValue([]),
  };
  const deliveries = {
    createBatch: vi.fn(async (
      rows: Array<Record<string, unknown>>,
      createdAt: Date,
    ) => rows.map((row) => ({
      ...row,
      createdAt,
      nextAttemptAt: createdAt,
      status: 'pending',
      updatedAt: createdAt,
    }))),
  };
  const dependencies = {
    botInstances,
    deliveries,
    employeeDirectory,
    employeeGroups,
    globalBroadcastConfig: config,
    ...overrides,
  } as unknown as BroadcastServiceDependencies;
  return {
    botInstances,
    config,
    deliveries,
    service: new BroadcastService(dependencies),
  };
}

function createEmployee(overrides: {
  claimedBotInstanceId: string | null;
  id: string;
} = { claimedBotInstanceId: 'bot_1', id: 'leader' }) {
  return {
    createdAt: new Date('2026-08-24T00:00:00.000Z'),
    enabled: true,
    id: overrides.id,
    legalName: overrides.id,
    nickname: overrides.id,
    claimedBotInstanceId: overrides.claimedBotInstanceId,
    updatedAt: new Date('2026-08-24T00:00:00.000Z'),
  };
}
