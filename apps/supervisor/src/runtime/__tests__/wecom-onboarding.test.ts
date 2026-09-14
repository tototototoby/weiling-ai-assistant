import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY } from '@weiling-ai/db';
import {
  WecomOnboardingFlow,
  type WecomOnboardingRepositoryLike,
} from '../wecom-onboarding';

describe('WecomOnboardingFlow', () => {
  it('uses the latest configured copy for the first name prompt', async () => {
    const fixture = createFixture({
      copy: {
        assistantName: 'Atlas',
        wecomBindingNamePrompt: '{{assistantName}} needs your employee name.',
      },
      sessionCreated: true,
    });

    await expect(fixture.flow.handleMessage({
      messageId: 'message_1',
      now: NOW,
      text: 'ignored on the first message',
      wecomUserId: 'user_1',
    })).resolves.toBe('Atlas needs your employee name.');

    expect(fixture.repository.bindByName).not.toHaveBeenCalled();
    expect(fixture.repository.completeReceipt).toHaveBeenCalledWith(
      'message_1',
      'Atlas needs your employee name.',
      NOW,
    );
  });

  it('binds the second message and leaves receipt completion inside the binding transaction', async () => {
    const fixture = createFixture({
      bindResult: {
        botInstanceId: 'bot_1',
        outcome: 'bound',
        session: createSession(),
        status: 'bound',
      },
      copy: {
        assistantName: 'Atlas',
        wecomBindingSuccess: '{{assistantName}} binding complete.',
      },
    });

    await expect(fixture.flow.handleMessage({
      messageId: 'message_2',
      now: NOW,
      text: ' Zhang San ',
      wecomUserId: 'user_1',
    })).resolves.toBe('Atlas binding complete.');

    expect(fixture.repository.bindByName).toHaveBeenCalledWith({
      messageId: 'message_2',
      name: 'Zhang San',
      now: NOW,
      successResponse: 'Atlas binding complete.',
      wecomUserId: 'user_1',
    });
    expect(fixture.repository.completeReceipt).not.toHaveBeenCalled();
  });

  it('returns the invalid-name copy during cooldown without attempting a bind', async () => {
    const fixture = createFixture({
      copy: {
        assistantName: 'Atlas',
        wecomBindingNameInvalid: 'Please try again later, {{assistantName}} is cooling down.',
      },
      session: createSession({
        cooldownUntil: new Date(NOW.getTime() + 1_000),
      }),
    });

    await expect(fixture.flow.handleMessage({
      messageId: 'message_cooldown',
      now: NOW,
      text: 'Zhang San',
      wecomUserId: 'user_1',
    })).resolves.toBe('Please try again later, Atlas is cooling down.');

    expect(fixture.repository.bindByName).not.toHaveBeenCalled();
    expect(fixture.repository.recordFailedAttempt).not.toHaveBeenCalled();
  });

  it('records a disabled employee as a failed attempt and never reports success', async () => {
    const fixture = createFixture({
      bindResult: {
        outcome: 'disabled',
        session: createSession(),
        status: 'disabled',
      },
      copy: {
        wecomBindingNameInvalid: 'No enabled employee matched.',
        wecomBindingSuccess: 'Binding complete.',
      },
    });

    await expect(fixture.flow.handleMessage({
      messageId: 'message_disabled',
      now: NOW,
      text: 'Disabled Employee',
      wecomUserId: 'user_1',
    })).resolves.toBe('No enabled employee matched.');

    expect(fixture.repository.recordFailedAttempt).toHaveBeenCalledWith({
      error: 'disabled',
      now: NOW,
      wecomUserId: 'user_1',
    });
    expect(fixture.repository.completeReceipt).toHaveBeenCalledWith(
      'message_disabled',
      'No enabled employee matched.',
      NOW,
    );
  });

  it('replays completed and in-progress receipts before touching session state', async () => {
    const completed = createFixture({
      claimResult: { response: 'Stored response', status: 'completed' },
    });
    await expect(completed.flow.handleMessage({
      messageId: 'message_completed',
      now: NOW,
      text: 'anything',
      wecomUserId: 'user_1',
    })).resolves.toBe('Stored response');
    expect(completed.repository.beginOrGetSession).not.toHaveBeenCalled();

    const processing = createFixture({
      claimResult: { status: 'processing' },
      copy: { wecomDuplicate: 'Already processing.' },
    });
    await expect(processing.flow.handleMessage({
      messageId: 'message_processing',
      now: NOW,
      text: 'anything',
      wecomUserId: 'user_1',
    })).resolves.toBe('Already processing.');
    expect(processing.repository.beginOrGetSession).not.toHaveBeenCalled();
  });
});

const NOW = new Date('2026-07-29T01:00:00.000Z');

function createFixture(input: {
  bindResult?: Awaited<ReturnType<WecomOnboardingRepositoryLike['bindByName']>>;
  claimResult?: Awaited<ReturnType<WecomOnboardingRepositoryLike['claimReceipt']>>;
  copy?: Partial<typeof DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY>;
  session?: ReturnType<typeof createSession>;
  sessionCreated?: boolean;
} = {}) {
  const session = input.session ?? createSession();
  const repository = {
    beginOrGetSession: vi.fn().mockResolvedValue({
      created: input.sessionCreated ?? false,
      session,
    }),
    bindByName: vi.fn().mockResolvedValue(input.bindResult ?? {
      outcome: 'not_found',
      session,
      status: 'not_found',
    }),
    claimReceipt: vi.fn().mockResolvedValue(input.claimResult ?? { status: 'claimed' }),
    completeReceipt: vi.fn().mockResolvedValue(undefined),
    findReceipt: vi.fn().mockResolvedValue(null),
    recordFailedAttempt: vi.fn().mockResolvedValue(session),
  };
  const messageCopy = {
    getCopy: vi.fn().mockResolvedValue({
      ...DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY,
      ...input.copy,
    }),
  };

  return {
    flow: new WecomOnboardingFlow(
      repository as unknown as WecomOnboardingRepositoryLike,
      messageCopy,
    ),
    messageCopy,
    repository,
  };
}

function createSession(overrides: { cooldownUntil?: Date | null } = {}) {
  return {
    attemptCount: 0,
    botInstanceId: null,
    boundAt: null,
    cooldownUntil: overrides.cooldownUntil ?? null,
    createdAt: NOW,
    employeeId: null,
    expiresAt: new Date(NOW.getTime() + 15 * 60_000),
    failedAttemptCount: 0,
    lastError: null,
    lastPromptAt: NOW,
    status: 'awaiting_name' as const,
    updatedAt: NOW,
    wecomUserId: 'user_1',
  };
}
