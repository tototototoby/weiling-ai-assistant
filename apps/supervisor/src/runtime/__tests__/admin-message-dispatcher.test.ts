import { describe, expect, it, vi } from 'vitest';
import type { AdminMessageDeliveryRepository } from '@weiling-ai/db';
import { AdminMessageDispatcher, getRetryDelayMs } from '../admin-message-dispatcher';

describe('AdminMessageDispatcher', () => {
  it('marks a claimed delivery sent only after FastAgent confirms delivery', async () => {
    const deliveries = createDeliveries();
    const config = createConfig();
    const processManager = { sendAdminMessage: vi.fn().mockResolvedValue(undefined) };
    const now = new Date('2026-07-23T02:00:00.000Z');

    await new AdminMessageDispatcher({
      botInstances: createBotInstances(),
      config,
      deliveries,
      processManager,
    }).runOnce(now);

    expect(deliveries.claimReady).toHaveBeenCalledWith({
      limit: 20,
      now,
      staleBefore: new Date('2026-07-23T01:59:00.000Z'),
    });
    expect(processManager.sendAdminMessage).toHaveBeenCalledWith(
      'bot_1',
      'delivery_1',
      '管理员通知',
    );
    expect(deliveries.markSent).toHaveBeenCalledWith('delivery_1', expect.any(Date));
    expect(deliveries.markAttemptFailed).not.toHaveBeenCalled();
  });

  it('returns failed delivery to the durable retry queue with bounded backoff', async () => {
    const deliveries = createDeliveries({ attemptCount: 3 });
    const config = createConfig();
    const processManager = {
      sendAdminMessage: vi.fn().mockRejectedValue(new Error('Expected exactly one active binding, found 2.')),
    };

    await new AdminMessageDispatcher({
      botInstances: createBotInstances(),
      config,
      deliveries,
      processManager,
    }).runOnce();

    expect(deliveries.markSent).not.toHaveBeenCalled();
    expect(deliveries.markAttemptFailed).toHaveBeenCalledWith(expect.objectContaining({
      deferAfterMaxAttempts: true,
      error: 'Expected exactly one active binding, found 2.',
      id: 'delivery_1',
      maxAttempts: 5,
    }));
    expect(getRetryDelayMs(1)).toBe(5_000);
    expect(getRetryDelayMs(3)).toBe(20_000);
    expect(getRetryDelayMs(99)).toBe(60_000);
  });

  it('preserves the semantic key when dispatching a scheduled delivery', async () => {
    const deliveries = createDeliveries({
      batchId: 'scheduled:meal:bot_1:2026-07-23',
      id: 'meal:bot_1:2026-07-23',
    });
    const processManager = { sendAdminMessage: vi.fn().mockResolvedValue(undefined) };

    await new AdminMessageDispatcher({
      botInstances: createBotInstances(),
      config: createConfig(),
      deliveries,
      processManager,
    }).runOnce();

    expect(processManager.sendAdminMessage).toHaveBeenCalledWith(
      'bot_1',
      'meal:bot_1:2026-07-23',
      '管理员通知',
      'meal:bot_1:2026-07-23',
    );
  });

  it('resumes only the active Bot waiting queue and delivers it immediately', async () => {
    const deliveries = createDeliveries();
    deliveries.resumeWaitingForBot = vi.fn().mockResolvedValue(1);
    const config = createConfig();
    const processManager = { sendAdminMessage: vi.fn().mockResolvedValue(undefined) };
    const now = new Date('2026-07-23T02:00:00.000Z');

    await expect(new AdminMessageDispatcher({
      botInstances: createBotInstances(),
      config,
      deliveries,
      processManager,
    })
      .handleUserActive('bot_1', now)).resolves.toBe(1);

    expect(deliveries.resumeWaitingForBot).toHaveBeenCalledWith('bot_1', now);
    expect(deliveries.claimReady).toHaveBeenCalledWith(expect.objectContaining({
      botInstanceId: 'bot_1',
      now,
    }));
    expect(processManager.sendAdminMessage).toHaveBeenCalledTimes(1);
  });

  it('does not scan the ready queue when no waiting delivery was resumed', async () => {
    const deliveries = createDeliveries();
    const processManager = { sendAdminMessage: vi.fn().mockResolvedValue(undefined) };

    await expect(new AdminMessageDispatcher({
      botInstances: createBotInstances(),
      config: createConfig(),
      deliveries,
      processManager,
    }).handleUserActive('bot_1')).resolves.toBe(0);

    expect(deliveries.claimReady).not.toHaveBeenCalled();
    expect(processManager.sendAdminMessage).not.toHaveBeenCalled();
  });

  it('fails durable waiting rows and disables activity wakeup when deferral is turned off', async () => {
    const deliveries = createDeliveries();
    const config = createConfig(false);
    const processManager = {
      sendAdminMessage: vi.fn().mockRejectedValue(new Error('Bot process is not running.')),
    };
    const dispatcher = new AdminMessageDispatcher({
      botInstances: createBotInstances(),
      config,
      deliveries,
      processManager,
    });
    const now = new Date('2026-07-23T02:00:00.000Z');

    await dispatcher.runOnce(now);
    await expect(dispatcher.handleUserActive('bot_1', now)).resolves.toBe(0);

    expect(deliveries.failWaiting).toHaveBeenCalledWith(now);
    expect(deliveries.markAttemptFailed).toHaveBeenCalledWith(expect.objectContaining({
      deferAfterMaxAttempts: false,
    }));
    expect(deliveries.resumeWaitingForBot).not.toHaveBeenCalled();
  });

  it('enqueues scheduled messages durably using the Bot owner and semantic key', async () => {
    const botInstances = createBotInstances();
    const deliveries = createDeliveries();
    const dispatcher = new AdminMessageDispatcher({
      botInstances,
      config: createConfig(),
      deliveries,
      processManager: { sendAdminMessage: vi.fn().mockResolvedValue(undefined) },
    });

    await dispatcher.sendAdminMessage(
      'bot_1',
      'delivery_1',
      '午餐提醒',
      'meal:bot_1:2026-07-23',
    );

    expect(botInstances.findById).toHaveBeenCalledWith('bot_1');
    expect(deliveries.createBatch).toHaveBeenCalledWith([{
      batchId: 'scheduled:meal:bot_1:2026-07-23',
      botInstanceId: 'bot_1',
      createdByUserId: 'user_1',
      id: 'meal:bot_1:2026-07-23',
      message: '午餐提醒',
      recipientUserId: 'user_1',
    }]);
  });

  it('propagates durable delivery identity conflicts', async () => {
    const deliveries = createDeliveries(
      {},
      new Error('Admin message delivery identity conflict: meal:bot_1:2026-07-23'),
    );
    const dispatcher = new AdminMessageDispatcher({
      botInstances: createBotInstances(),
      config: createConfig(),
      deliveries,
      processManager: { sendAdminMessage: vi.fn().mockResolvedValue(undefined) },
    });

    await expect(dispatcher.sendAdminMessage(
      'bot_1',
      'meal:bot_1:2026-07-23',
      '午餐提醒',
    )).rejects.toThrow('identity conflict');
  });
});

function createConfig(enabled = true) {
  return {
    ensure: vi.fn().mockResolvedValue({ deferFailedUntilUserActive: enabled }),
  };
}

function createBotInstances() {
  return {
    findById: vi.fn().mockResolvedValue({ ownerUserId: 'user_1' }),
  };
}

function createDeliveries(
  overrides: Record<string, unknown> = {},
  createError?: Error,
) {
  return {
    createBatch: createError
      ? vi.fn().mockRejectedValue(createError)
      : vi.fn().mockResolvedValue([]),
    claimReady: vi.fn().mockResolvedValue([{
      attemptCount: 1,
      batchId: 'batch_1',
      botInstanceId: 'bot_1',
      id: 'delivery_1',
      message: '管理员通知',
      ...overrides,
    }]),
    markAttemptFailed: vi.fn().mockResolvedValue('pending'),
    failWaiting: vi.fn().mockResolvedValue(0),
    markSent: vi.fn().mockResolvedValue(undefined),
    resumeWaitingForBot: vi.fn().mockResolvedValue(0),
  } as unknown as AdminMessageDeliveryRepository;
}
