import type { BotInstanceRepository } from '@weiling-ai/db';
import { describe, expect, it, vi } from 'vitest';
import { InstanceLock } from '../instance-lock';
import { InstanceReconciler } from '../instance-reconciler';
import type { ProcessManager } from '../process-manager';

describe('InstanceReconciler process heartbeat', () => {
  it('refreshes a stale heartbeat for a tracked bot process', async () => {
    const previousHeartbeat = new Date('2026-07-25T00:00:00.000Z');
    const now = new Date('2026-07-25T00:00:30.000Z');
    const bot = {
      desiredState: 'running',
      heartbeatAt: previousHeartbeat,
      id: 'bot_1',
      qrReissueRequestedAt: null,
      restartRequestedAt: null,
      status: 'running',
    };
    const botInstances = {
      findById: vi.fn().mockResolvedValue(bot),
      findReconcileCandidates: vi.fn().mockResolvedValue([bot]),
      findStopCandidates: vi.fn().mockResolvedValue([]),
      recordHeartbeat: vi.fn().mockResolvedValue(undefined),
    } as unknown as BotInstanceRepository;
    const processManager = {
      hasInstance: vi.fn().mockReturnValue(true),
    } as unknown as ProcessManager;
    const reconciler = new InstanceReconciler({
      botInstances,
      lock: new InstanceLock(),
      processManager,
    });

    await reconciler.runOnce(now);

    expect(botInstances.recordHeartbeat).toHaveBeenCalledWith('bot_1', now);
  });

  it('does not churn the database while the heartbeat is still fresh', async () => {
    const previousHeartbeat = new Date('2026-07-25T00:00:00.000Z');
    const bot = {
      desiredState: 'running',
      heartbeatAt: previousHeartbeat,
      id: 'bot_1',
      qrReissueRequestedAt: null,
      restartRequestedAt: null,
      status: 'running',
    };
    const botInstances = {
      findById: vi.fn().mockResolvedValue(bot),
      findReconcileCandidates: vi.fn().mockResolvedValue([bot]),
      findStopCandidates: vi.fn().mockResolvedValue([]),
      recordHeartbeat: vi.fn().mockResolvedValue(undefined),
    } as unknown as BotInstanceRepository;
    const processManager = {
      hasInstance: vi.fn().mockReturnValue(true),
    } as unknown as ProcessManager;
    const reconciler = new InstanceReconciler({
      botInstances,
      lock: new InstanceLock(),
      processManager,
    });

    await reconciler.runOnce(new Date('2026-07-25T00:00:29.999Z'));

    expect(botInstances.recordHeartbeat).not.toHaveBeenCalled();
  });
});
