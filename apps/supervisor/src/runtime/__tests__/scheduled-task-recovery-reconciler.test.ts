import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupervisorConfig } from '../../config';
import { ScheduledTaskRecoveryReconciler } from '../scheduled-task-recovery-reconciler';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('ScheduledTaskRecoveryReconciler', () => {
  it('delivers generated recovery replies through IM once and skips already handled ones', async () => {
    const fixture = await createFixture();
    await fixture.writeTasksFile([
      recoveryEvent('recovery-1', 'task-1', 'first prompt', 1787983141376),
      recoveryEvent('recovery-2', 'task-2', 'second prompt', 1787983141376),
    ]);

    await fixture.reconciler.runOnce();
    expect(fixture.externalTurns).toEqual([
      ['bot_1', 'scheduled-recovery:recovery-1', 'first prompt'],
      ['bot_1', 'scheduled-recovery:recovery-2', 'second prompt'],
    ]);
    expect(fixture.sentMessages).toEqual([
      [
        'bot_1',
        'scheduled-recovery:recovery-1',
        'reply to first prompt',
        'scheduled-recovery:recovery-1',
      ],
      [
        'bot_1',
        'scheduled-recovery:recovery-2',
        'reply to second prompt',
        'scheduled-recovery:recovery-2',
      ],
    ]);
    expect(fixture.delivered).toEqual(['recovery-1', 'recovery-2']);

    await fixture.reconciler.runOnce();
    expect(fixture.externalTurns).toHaveLength(2);
    expect(fixture.sentMessages).toHaveLength(2);
  });

  it('marks recoveries as failed when the external turn throws and retries stale failures', async () => {
    const fixture = await createFixture({ failRequestIds: new Set(['scheduled-recovery:recovery-1']) });
    await fixture.writeTasksFile([recoveryEvent('recovery-1', 'task-1', 'prompt', 1787983141376)]);

    await fixture.reconciler.runOnce();
    expect(fixture.failed).toEqual(['recovery-1']);
    expect(fixture.delivered).toEqual([]);
    expect(fixture.sentMessages).toEqual([]);

    fixture.failRequestIds.clear();
    fixture.nowRef.value = new Date('2026-08-31T10:05:00.000Z');
    await fixture.reconciler.runOnce();
    expect(fixture.externalTurns).toHaveLength(2);
    expect(fixture.sentMessages).toEqual([
      [
        'bot_1',
        'scheduled-recovery:recovery-1',
        'reply to prompt',
        'scheduled-recovery:recovery-1',
      ],
    ]);
    expect(fixture.delivered).toEqual(['recovery-1']);
  });

  it('does not mark a recovery delivered until final IM delivery succeeds', async () => {
    const deliveryId = 'scheduled-recovery:recovery-1';
    const fixture = await createFixture({ failDeliveryIds: new Set([deliveryId]) });
    await fixture.writeTasksFile([recoveryEvent('recovery-1', 'task-1', 'prompt', 1787983141376)]);

    await fixture.reconciler.runOnce();
    expect(fixture.sentMessages).toEqual([
      ['bot_1', deliveryId, 'reply to prompt', deliveryId],
    ]);
    expect(fixture.failed).toEqual(['recovery-1']);
    expect(fixture.delivered).toEqual([]);

    fixture.failDeliveryIds.clear();
    fixture.nowRef.value = new Date('2026-08-31T10:05:00.000Z');
    await fixture.reconciler.runOnce();

    expect(fixture.externalTurns).toHaveLength(2);
    expect(fixture.sentMessages).toEqual([
      ['bot_1', deliveryId, 'reply to prompt', deliveryId],
      ['bot_1', deliveryId, 'reply to prompt', deliveryId],
    ]);
    expect(fixture.delivered).toEqual(['recovery-1']);
  });

  it('ignores missing task files and malformed lines', async () => {
    const fixture = await createFixture();
    await fixture.writeTasksFile(['not json', '', JSON.stringify({ type: 'task_created' })]);

    await expect(fixture.reconciler.runOnce()).resolves.toBeUndefined();
    expect(fixture.externalTurns).toEqual([]);
  });
});

function recoveryEvent(recoveryId: string, taskId: string, prompt: string, scheduledFor: number) {
  return JSON.stringify({
    type: 'recovery_created',
    recovery: {
      createdAt: 1788185957554,
      kind: 'missed_one_shot',
      prompt,
      recoveryId,
      scheduledFor,
      sessionId: 'session-1',
      taskId,
      workspaceDir: '/workspace',
    },
  });
}

async function createFixture(input: {
  failDeliveryIds?: Set<string>;
  failRequestIds?: Set<string>;
} = {}) {
  const instancesRoot = await mkdtemp(join(tmpdir(), 'weiling-recovery-'));
  tempDirs.push(instancesRoot);
  const dataDir = join(instancesRoot, 'bot_1', 'data');
  const tasksDir = join(dataDir, 'scheduled-tasks', 'im-gateway');
  await mkdir(tasksDir, { recursive: true });

  const config: SupervisorConfig = {
    databaseUrl: 'file::memory:',
    fastagentBinaryPath: 'fastagent',
    internalApiToken: 'token',
    internalPort: 8790,
    instancesRoot,
    larkConfigRoot: instancesRoot,
    larkCliPath: 'lark-cli',
    mockFastAgentFixturePath: 'mock',
    reconcileIntervalMs: 2000,
    reconcileStallTimeoutMs: 120000,
    sandboxApiKey: null,
    sandboxMode: 'remote',
    sandboxUrl: null,
    srtPoolConfigFile: null,
    srtPoolDefaults: null,
    srtPoolStatusFile: null,
    srtServiceHost: null,
    srtWorkspaceMapDir: null,
    workspaceRoot: instancesRoot,
  };

  const externalTurns: string[][] = [];
  const delivered: string[] = [];
  const failed: string[] = [];
  const failDeliveryIds = input.failDeliveryIds ?? new Set<string>();
  const failRequestIds = input.failRequestIds ?? new Set<string>();
  const sentMessages: Array<[string, string, string, string | undefined]> = [];
  const state = new Map<string, { status: string; updatedAt: number; attempts: number }>();
  const nowRef = { value: new Date('2026-08-31T10:00:00.000Z') };

  const reconciler = new ScheduledTaskRecoveryReconciler({
    botInstances: {
      listAllForAdministration: async () => [{ id: 'bot_1' } as never],
    },
    config,
    messageSender: {
      sendAdminMessage: async (botInstanceId, deliveryId, text, semanticKey) => {
        sentMessages.push([botInstanceId, deliveryId, text, semanticKey]);
        if (failDeliveryIds.has(deliveryId)) {
          throw new Error('IM delivery failed');
        }
      },
    },
    now: () => nowRef.value,
    processManager: {
      runExternalTurn: async (botInstanceId: string, requestId: string, text: string) => {
        externalTurns.push([botInstanceId, requestId, text]);
        if (failRequestIds.has(requestId)) {
          throw new Error('external turn failed');
        }
        return `reply to ${text}`;
      },
    },
    recoveries: {
      claim: async (input: { recoveryId: string }) => {
        const existing = state.get(input.recoveryId);
        if (!existing) {
          state.set(input.recoveryId, { attempts: 1, status: 'delivering', updatedAt: nowRef.value.getTime() });
          return 'claimed';
        }
        if (existing.status === 'delivered') return 'delivered';
        if (existing.status === 'delivering' && nowRef.value.getTime() - existing.updatedAt < 60_000) {
          return 'processing';
        }
        existing.attempts += 1;
        existing.status = 'delivering';
        existing.updatedAt = nowRef.value.getTime();
        return 'claimed';
      },
      markDelivered: async (recoveryId: string) => {
        delivered.push(recoveryId);
        state.set(recoveryId, { attempts: 1, status: 'delivered', updatedAt: nowRef.value.getTime() });
      },
      markFailed: async (recoveryId: string) => {
        failed.push(recoveryId);
        state.set(recoveryId, { attempts: 1, status: 'failed', updatedAt: nowRef.value.getTime() });
      },
    } as never,
  });

  return {
    delivered,
    externalTurns,
    failDeliveryIds,
    failRequestIds,
    failed,
    nowRef,
    reconciler,
    sentMessages,
    writeTasksFile: async (lines: string[]) => {
      await writeFile(join(tasksDir, 'tasks.jsonl'), `${lines.join('\n')}\n`, 'utf8');
    },
  };
}
