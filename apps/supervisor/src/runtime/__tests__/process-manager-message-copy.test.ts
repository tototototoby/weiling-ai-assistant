import { DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY } from '@weiling-ai/db';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { ProcessManager } from '../process-manager';
import { ProcessRegistry } from '../process-registry';

describe('ProcessManager message copy', () => {
  it('pushes the latest processing acknowledgement to every running FastAgent child', async () => {
    const registry = new ProcessRegistry();
    const send = vi.fn();
    const child = { connected: true, send } as unknown as ChildProcess;
    registry.add({
      applyChain: Promise.resolve(),
      botInstanceId: 'bot_1',
      child,
      fatalRuntimeFailureHandled: false,
      forceKillTimer: null,
      terminalStoppedHandled: false,
      terminationRequested: false,
    });
    const messageCopy = {
      getCopy: vi.fn().mockResolvedValue({
        ...DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY,
        assistantName: 'Company Assistant',
        processingAck: '{{assistantName}} is processing your request',
      }),
    };
    const manager = new ProcessManager({
      botEvents: {} as never,
      botInstances: {} as never,
      botSandboxRuntimePools: {} as never,
      config: {} as never,
      messageCopy,
      registry,
      userLlmProfiles: {} as never,
    });

    await manager.syncMessageCopy();

    expect(messageCopy.getCopy).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      assistantName: 'Company Assistant',
      processingAck: 'Company Assistant is processing your request',
      type: 'weclaws_message_copy',
    });
  });
});
