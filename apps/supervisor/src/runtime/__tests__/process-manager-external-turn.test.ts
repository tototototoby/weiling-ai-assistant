import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import type {
  BotEventRepository,
  BotInstanceRepository,
  BotSandboxRuntimePoolRepository,
  UserLlmProfileRepository,
} from '@weiling-ai/db';
import type { SupervisorConfig } from '../../config';
import { ProcessManager } from '../process-manager';
import { ProcessRegistry, type ManagedProcessEntry } from '../process-registry';

describe('ProcessManager external turns', () => {
  it('sends the request over IPC and resolves the matching child result', async () => {
    const fixture = createHarness((child, message) => {
      queueMicrotask(() => child.emit('message', {
        ok: true,
        requestId: message.requestId,
        text: `External reply: ${message.text}`,
        type: 'weclaws_external_turn_result',
      }));
    });

    await expect(fixture.manager.runExternalTurn('bot_1', 'request_1', ' hello '))
      .resolves.toBe('External reply: hello');
    expect(fixture.child.send).toHaveBeenCalledWith({
      forwardEvents: false,
      requestId: 'request_1',
      text: 'hello',
      type: 'weclaws_external_turn',
    }, expect.any(Function));

    await fixture.manager.dispose();
  });

  it('normalizes and forwards a bounded deny-tools list over IPC', async () => {
    const fixture = createHarness((child, message) => {
      queueMicrotask(() => child.emit('message', {
        ok: true,
        requestId: message.requestId,
        text: 'isolated',
        type: 'weclaws_external_turn_result',
      }));
    });

    await expect(fixture.manager.runExternalTurn('bot_1', 'isolated_1', 'hello', {
      denyTools: [' send_im_media ', 'SEND_IM', 'send_im_media'],
    })).resolves.toBe('isolated');
    expect(fixture.child.send).toHaveBeenCalledWith({
      denyTools: ['send_im_media', 'send_im'],
      forwardEvents: false,
      requestId: 'isolated_1',
      text: 'hello',
      type: 'weclaws_external_turn',
    }, expect.any(Function));

    await fixture.manager.dispose();
  });

  it('rejects malformed or excessive external-turn tool names before IPC', async () => {
    const fixture = createHarness();

    await expect(fixture.manager.runExternalTurn('bot_1', 'invalid_name', 'hello', {
      denyTools: ['send/im'],
    })).rejects.toThrow('External turn denied tool name is invalid');
    await expect(fixture.manager.runExternalTurn('bot_1', 'too_many', 'hello', {
      denyTools: Array.from({ length: 33 }, (_, index) => `tool_${index}`),
    })).rejects.toThrow('External turn denyTools cannot contain more than 32 names');
    await expect(fixture.manager.runExternalTurn('bot_1', 'invalid_type', 'hello', {
      denyTools: 'send_im' as unknown as string[],
    })).rejects.toThrow('External turn denyTools must be an array');
    expect(fixture.child.send).not.toHaveBeenCalled();

    await fixture.manager.dispose();
  });

  it('forwards progress events to the caller when onEvent is provided', async () => {
    const onEvent = vi.fn();
    const fixture = createHarness((child, message) => {
      queueMicrotask(() => {
        child.emit('message', {
          event: { data: { text: 'first ' }, type: 'message_delta' },
          requestId: message.requestId,
          type: 'weclaws_external_turn_event',
        });
        child.emit('message', {
          event: { data: { id: 'call_1', input: { q: 1 }, name: 'search' }, type: 'tool_call' },
          requestId: message.requestId,
          type: 'weclaws_external_turn_event',
        });
        child.emit('message', {
          ok: true,
          requestId: message.requestId,
          text: 'final',
          type: 'weclaws_external_turn_result',
        });
      });
    });

    await expect(fixture.manager.runExternalTurn('bot_1', 'stream_1', 'hello', { onEvent }))
      .resolves.toBe('final');

    expect(fixture.child.send).toHaveBeenCalledWith({
      forwardEvents: true,
      requestId: 'stream_1',
      text: 'hello',
      type: 'weclaws_external_turn',
    }, expect.any(Function));
    expect(onEvent).toHaveBeenCalledWith({ data: { text: 'first ' }, type: 'message_delta' });
    expect(onEvent).toHaveBeenCalledWith({
      data: { id: 'call_1', input: { q: 1 }, name: 'search' },
      type: 'tool_call',
    });

    await fixture.manager.dispose();
  });

  it('does not forward events for the matching run when onEvent is omitted', async () => {
    const fixture = createHarness((child, message) => {
      queueMicrotask(() => {
        child.emit('message', {
          event: { type: 'message_delta', data: { text: 'ignored' } },
          requestId: message.requestId,
          type: 'weclaws_external_turn_event',
        });
        child.emit('message', {
          ok: true,
          requestId: message.requestId,
          text: 'ok',
          type: 'weclaws_external_turn_result',
        });
      });
    });

    await expect(fixture.manager.runExternalTurn('bot_1', 'plain_1', 'hello'))
      .resolves.toBe('ok');
    expect(fixture.child.send).toHaveBeenCalledWith({
      forwardEvents: false,
      requestId: 'plain_1',
      text: 'hello',
      type: 'weclaws_external_turn',
    }, expect.any(Function));

    await fixture.manager.dispose();
  });

  it('rejects child errors, empty replies, and duplicate in-flight request IDs', async () => {
    const fixture = createHarness((child, message) => {
      if (message.requestId === 'in_flight') return;
      queueMicrotask(() => child.emit('message', {
        error: message.requestId === 'failed' ? 'model unavailable' : undefined,
        ok: message.requestId !== 'failed',
        requestId: message.requestId,
        text: message.requestId === 'empty' ? ' ' : undefined,
        type: 'weclaws_external_turn_result',
      }));
    });

    await expect(fixture.manager.runExternalTurn('bot_1', 'failed', 'hello'))
      .rejects.toThrow('model unavailable');
    await expect(fixture.manager.runExternalTurn('bot_1', 'empty', 'hello'))
      .rejects.toThrow('FastAgent external turn returned an empty reply.');

    const pending = fixture.manager.runExternalTurn('bot_1', 'in_flight', 'hello', 1_000);
    await expect(fixture.manager.runExternalTurn('bot_1', 'in_flight', 'hello', 1_000))
      .rejects.toThrow('External turn is already in progress.');
    fixture.child.emit('close');
    await expect(pending).rejects.toThrow('Bot process exited before the external turn completed.');

    await fixture.manager.dispose();
  });

  it('validates input and releases a timed-out request ID for a later attempt', async () => {
    const fixture = createHarness((child, message) => {
      if (message.text === 'hang') return;
      queueMicrotask(() => child.emit('message', {
        ok: true,
        requestId: message.requestId,
        text: 'recovered',
        type: 'weclaws_external_turn_result',
      }));
    });

    await expect(fixture.manager.runExternalTurn('bot_1', ' ', 'hello'))
      .rejects.toThrow('External turn request ID is required.');
    await expect(fixture.manager.runExternalTurn('bot_1', 'request_1', ' '))
      .rejects.toThrow('External turn text cannot be empty.');
    await expect(fixture.manager.runExternalTurn('bot_1', 'request_1', 'x'.repeat(64 * 1024 + 1)))
      .rejects.toThrow('External turn text is too large.');
    await expect(fixture.manager.runExternalTurn('bot_1', 'request_1', 'hang', 10))
      .rejects.toThrow('FastAgent external turn timed out.');
    await expect(fixture.manager.runExternalTurn('bot_1', 'request_1', 'retry'))
      .resolves.toBe('recovered');

    await fixture.manager.dispose();
  });

  it('fails fast when the Bot or IPC channel is unavailable', async () => {
    const empty = createHarness();
    empty.registry.delete('bot_1');
    await expect(empty.manager.runExternalTurn('bot_1', 'request_1', 'hello'))
      .rejects.toThrow('Bot process is not running.');

    const disconnected = createHarness();
    disconnected.child.connected = false;
    await expect(disconnected.manager.runExternalTurn('bot_1', 'request_1', 'hello'))
      .rejects.toThrow('Bot process IPC channel is unavailable.');

    await empty.manager.dispose();
    await disconnected.manager.dispose();
  });

  it('forwards a completed personal Weixin turn as Bot activity', async () => {
    const onUserActive = vi.fn().mockResolvedValue(undefined);
    const fixture = createHarness(undefined, onUserActive);

    fixture.child.emit('message', { type: 'weclaws_user_active' });

    await vi.waitFor(() => {
      expect(onUserActive).toHaveBeenCalledWith('bot_1');
    });
    await fixture.manager.dispose();
  });

  it('ignores malformed or identity-spoofing activity IPC messages', async () => {
    const onUserActive = vi.fn().mockResolvedValue(undefined);
    const fixture = createHarness(undefined, onUserActive);

    fixture.child.emit('message', null);
    fixture.child.emit('message', { type: 'weclaws_user_active', botInstanceId: 'bot_2' });
    fixture.child.emit('message', { type: 'other' });
    await Promise.resolve();

    expect(onUserActive).not.toHaveBeenCalled();
    await fixture.manager.dispose();
  });

  it('contains activity callback failures without crashing the child listener', async () => {
    const callbackError = new Error('database unavailable');
    const onUserActive = vi.fn().mockRejectedValue(callbackError);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fixture = createHarness(undefined, onUserActive);

    try {
      fixture.child.emit('message', { type: 'weclaws_user_active' });

      await vi.waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          'Failed to resume deferred messages for Bot bot_1.',
        );
        expect(consoleError).toHaveBeenCalledWith(callbackError);
      });
    } finally {
      consoleError.mockRestore();
      await fixture.manager.dispose();
    }
  });
});

function createHarness(
  onSend?: (child: FakeChildProcess, message: Record<string, string>) => void,
  onUserActive?: (botInstanceId: string) => Promise<unknown>,
) {
  const registry = new ProcessRegistry();
  const child = new FakeChildProcess(onSend);
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
    botEvents: {} as BotEventRepository,
    botInstances: {} as BotInstanceRepository,
    botSandboxRuntimePools: {} as BotSandboxRuntimePoolRepository,
    config: {} as SupervisorConfig,
    onUserActive,
    registry,
    userLlmProfiles: {} as UserLlmProfileRepository,
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
  readonly send: ReturnType<typeof vi.fn>;

  constructor(onSend?: (child: FakeChildProcess, message: Record<string, string>) => void) {
    super();
    this.send = vi.fn((message: Record<string, string>, callback?: (error: Error | null) => void) => {
      callback?.(null);
      onSend?.(this, message);
      return true;
    });
  }
}
