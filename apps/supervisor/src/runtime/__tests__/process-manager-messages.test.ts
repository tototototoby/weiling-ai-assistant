import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { ProcessManager } from '../process-manager';
import { ProcessRegistry, type ManagedProcessEntry } from '../process-registry';

describe('ProcessManager user active messages', () => {
  it('increments daily inbound activity when a weclaws_user_active message arrives', async () => {
    const onUserActive = vi.fn().mockResolvedValue(undefined);
    const incrementInbound = vi.fn().mockResolvedValue(undefined);
    const fixture = createHarness({
      incrementInbound,
      onUserActive,
    });

    try {
      fixture.child.emit('message', { type: 'weclaws_user_active' });

      await vi.waitFor(() => {
        expect(onUserActive).toHaveBeenCalledWith('bot_1');
      });
      await vi.waitFor(() => {
        expect(incrementInbound).toHaveBeenCalledWith(
          'bot_1',
          expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        );
      });
    } finally {
      await fixture.manager.dispose();
    }
  });

  it('ignores malformed activity messages', async () => {
    const onUserActive = vi.fn().mockResolvedValue(undefined);
    const incrementInbound = vi.fn().mockResolvedValue(undefined);
    const fixture = createHarness({
      incrementInbound,
      onUserActive,
    });

    try {
      fixture.child.emit('message', { type: 'weclaws_user_active', botInstanceId: 'bot_2' });
      fixture.child.emit('message', { type: 'other' });
      await Promise.resolve();

      expect(onUserActive).not.toHaveBeenCalled();
      expect(incrementInbound).not.toHaveBeenCalled();
    } finally {
      await fixture.manager.dispose();
    }
  });

  it('logs activity recording failures without breaking the message listener', async () => {
    const activityError = new Error('database unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fixture = createHarness({
      incrementInbound: vi.fn().mockRejectedValue(activityError),
      onUserActive: vi.fn().mockResolvedValue(undefined),
    });

    try {
      fixture.child.emit('message', { type: 'weclaws_user_active' });

      await vi.waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          'Failed to record daily activity for Bot bot_1.',
        );
        expect(consoleError).toHaveBeenCalledWith(activityError);
      });
    } finally {
      consoleError.mockRestore();
      await fixture.manager.dispose();
    }
  });
});

function createHarness(input: {
  incrementInbound: ReturnType<typeof vi.fn>;
  onUserActive: ReturnType<typeof vi.fn>;
}) {
  const registry = new ProcessRegistry();
  const child = new FakeChildProcess();
  const entry: ManagedProcessEntry = {
    applyChain: Promise.resolve(),
    botInstanceId: 'bot_1',
    child: child as unknown as ChildProcess,
    fatalRuntimeFailureHandled: false,
    forceKillTimer: null,
    terminalStoppedHandled: false,
    terminationRequested: false,
  };
  const manager = new ProcessManager({
    botDailyActivity: {
      incrementInbound: input.incrementInbound,
    } as never,
    botEvents: {} as never,
    botInstances: {} as never,
    botSandboxRuntimePools: {} as never,
    config: {} as never,
    onUserActive: input.onUserActive as (botInstanceId: string) => unknown,
    registry,
    userLlmProfiles: {} as never,
  });

  registry.add(entry);
  Reflect.apply(
    (manager as unknown as { attachProcessListeners: (...args: unknown[]) => void })
      .attachProcessListeners,
    manager,
    ['bot_1', child, entry, { flush: vi.fn(), push: vi.fn() }],
  );

  return { child, manager, registry };
}

class FakeChildProcess extends EventEmitter {
  connected = true;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  stderr = null;
  stdout = null;
  readonly kill = vi.fn(() => true);
  readonly send = vi.fn();
}
