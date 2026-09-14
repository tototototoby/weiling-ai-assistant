import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { normalizeEmployeeLookupName } from '@weiling-ai/shared';
import { createDatabaseClient, migrateDatabase } from '../../client.js';
import { botWecomBindings } from '../../schema/bot-wecom-bindings.js';
import { employeeDirectoryEntries } from '../../schema/employee-directory-entries.js';
import { wecomOnboardingReceipts } from '../../schema/wecom-onboarding-receipts.js';
import { wecomOnboardingSessions } from '../../schema/wecom-onboarding-sessions.js';
import { BotInstanceRepository } from '../bot-instance-repository.js';
import { EmployeeDirectoryRepository } from '../employee-directory-repository.js';
import { UserRepository } from '../user-repository.js';
import { WecomOnboardingRepository } from '../wecom-onboarding-repository.js';
import { WorkspaceRepository } from '../workspace-repository.js';

const clients: Array<ReturnType<typeof createDatabaseClient>> = [];

afterEach(() => clients.splice(0).forEach((client) => client.close()));

describe('WecomOnboardingRepository receipts', () => {
  it('deduplicates, reclaims stale processing, replays the response, and rejects identity collisions', async () => {
    const { client, onboarding } = await createFixture();
    const firstAt = new Date('2026-07-28T01:00:00.000Z');

    await expect(onboarding.claimReceipt({
      messageId: ' message_1 ',
      receivedAt: firstAt,
      wecomUserId: ' user_1 ',
    })).resolves.toEqual({ status: 'claimed' });
    await expect(onboarding.findReceipt(' message_1 ', ' user_1 '))
      .resolves.toEqual({ status: 'processing' });
    await expect(onboarding.findReceipt('message_1', 'different_user')).resolves.toBeNull();
    await expect(onboarding.claimReceipt({
      messageId: 'message_1',
      receivedAt: new Date(firstAt.getTime() + 1_000),
      staleBefore: new Date(firstAt.getTime() - 1),
      wecomUserId: 'user_1',
    })).resolves.toEqual({ status: 'processing' });
    await expect(onboarding.claimReceipt({
      messageId: 'message_1',
      wecomUserId: 'different_user',
    })).rejects.toThrow('identity conflict');

    const reclaimedAt = new Date(firstAt.getTime() + 120_000);
    await expect(onboarding.claimReceipt({
      messageId: 'message_1',
      receivedAt: reclaimedAt,
      staleBefore: firstAt,
      wecomUserId: 'user_1',
    })).resolves.toEqual({ status: 'claimed' });
    await expect(onboarding.completeReceipt('message_1', ' completed response ', reclaimedAt))
      .resolves.toBeUndefined();
    await expect(onboarding.findReceipt('message_1', 'user_1')).resolves.toEqual({
      response: 'completed response',
      status: 'completed',
    });
    await expect(onboarding.completeReceipt('message_1', 'later response'))
      .resolves.toBeUndefined();
    await expect(onboarding.claimReceipt({
      messageId: 'message_1',
      wecomUserId: 'user_1',
    })).resolves.toEqual({ response: 'completed response', status: 'completed' });

    expect(client.db.select().from(wecomOnboardingReceipts).all()).toEqual([
      expect.objectContaining({
        attemptCount: 2,
        error: null,
        messageId: 'message_1',
        response: 'completed response',
        status: 'completed',
        wecomUserId: 'user_1',
      }),
    ]);
  });
});

describe('WecomOnboardingRepository sessions', () => {
  it('begins idempotently, records bounded failures, lists, and deletes sessions', async () => {
    const { onboarding } = await createFixture();
    const startedAt = new Date('2026-07-28T02:00:00.000Z');
    const expiresAt = new Date(startedAt.getTime() + 30 * 60_000);
    const first = await onboarding.beginOrGetSession({
      expiresAt,
      startedAt,
      wecomUserId: ' user_1 ',
    });
    const same = await onboarding.beginOrGetSession({
      startedAt: new Date(startedAt.getTime() + 1_000),
      wecomUserId: 'user_1',
    });
    let failed = same.session;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      failed = await onboarding.recordFailedAttempt({
        attemptedAt: new Date(startedAt.getTime() + (attempt + 1) * 1_000),
        error: ' invalid-name ',
        wecomUserId: 'user_1',
      });
    }

    expect(first).toMatchObject({
      created: true,
      session: { createdAt: startedAt, expiresAt, failedAttemptCount: 0 },
    });
    expect(same).toEqual({ created: false, session: first.session });
    expect(failed).toMatchObject({
      attemptCount: 5,
      expiresAt,
      failedAttemptCount: 5,
      lastError: 'invalid-name',
      status: 'awaiting_name',
      wecomUserId: 'user_1',
    });
    expect(failed.cooldownUntil).toEqual(new Date(startedAt.getTime() + 10 * 60_000 + 6_000));
    const duringCooldown = await onboarding.recordFailedAttempt({
      attemptedAt: new Date(startedAt.getTime() + 7_000),
      wecomUserId: 'user_1',
    });
    expect(duringCooldown).toEqual(failed);
    await expect(onboarding.listSessions()).resolves.toEqual([failed]);
    await expect(onboarding.deleteSession(' user_1 ')).resolves.toBe(true);
    await expect(onboarding.deleteSession('user_1')).resolves.toBe(false);
  });

  it('binds the unique enabled claimed employee and is idempotent', async () => {
    const { client, onboarding } = await createFixture({
      employees: [{ botId: 'bot_1', id: 'employee_1', legalName: '章廷', nickname: 'Ting' }],
    });
    const boundAt = new Date('2026-07-28T03:00:00.000Z');

    const first = await claimAndBind(onboarding, {
      boundAt,
      submittedName: '  ＴＩＮＧ  ',
      wecomUserId: ' zhang.ting ',
    });
    const repeated = await claimAndBind(onboarding, {
      boundAt: new Date(boundAt.getTime() + 1_000),
      submittedName: 'Ting',
      wecomUserId: 'zhang.ting',
    });

    expect(first).toMatchObject({
      outcome: 'bound',
      session: {
        botInstanceId: 'bot_1',
        employeeId: 'employee_1',
        status: 'bound',
      },
    });
    expect(repeated).toMatchObject({ outcome: 'already_bound' });
    expect(client.db.select().from(botWecomBindings).all()).toEqual([
      expect.objectContaining({
        botInstanceId: 'bot_1',
        employeeId: 'employee_1',
        enabled: true,
        wecomUserId: 'zhang.ting',
      }),
    ]);
    await expect(onboarding.listSessions()).resolves.toEqual([]);
    expect(client.db.select().from(wecomOnboardingReceipts).all()).toEqual([
      expect.objectContaining({ response: 'binding succeeded', status: 'completed' }),
      expect.objectContaining({ response: 'binding succeeded', status: 'completed' }),
    ]);
  });

  it('classifies invalid, missing, disabled, unclaimed, ambiguous, and dangling employees', async () => {
    const { client, onboarding } = await createFixture({
      employees: [
        { botId: 'bot_1', enabled: false, id: 'disabled', legalName: 'Disabled' },
        { id: 'unclaimed', legalName: 'Unclaimed' },
        { botId: 'bot_2', id: 'duplicate_1', nickname: 'Duplicate' },
        { botId: 'bot_3', id: 'duplicate_2', nickname: 'Duplicate' },
        { botId: 'missing_bot', id: 'dangling', legalName: 'Dangling', skipBot: true },
      ],
    });

    await expect(claimAndBind(onboarding, {
      submittedName: '   ',
      wecomUserId: 'invalid',
    })).resolves.toMatchObject({ outcome: 'invalid_name' });
    await expect(claimAndBind(onboarding, {
      submittedName: 'Missing',
      wecomUserId: 'missing',
    })).resolves.toMatchObject({ outcome: 'not_found' });
    await expect(claimAndBind(onboarding, {
      submittedName: 'Disabled',
      wecomUserId: 'disabled',
    })).resolves.toMatchObject({ outcome: 'disabled' });
    await expect(claimAndBind(onboarding, {
      submittedName: 'Unclaimed',
      wecomUserId: 'unclaimed',
    })).resolves.toMatchObject({ outcome: 'unclaimed' });
    await expect(claimAndBind(onboarding, {
      submittedName: 'Duplicate',
      wecomUserId: 'duplicate',
    })).resolves.toMatchObject({ outcome: 'ambiguous' });
    await expect(claimAndBind(onboarding, {
      submittedName: 'Dangling',
      wecomUserId: 'dangling',
    })).resolves.toMatchObject({ outcome: 'bot_missing' });

    expect(client.db.select().from(botWecomBindings).all()).toEqual([]);
  });

  it('does not overwrite a WeCom userid or Bot that is already bound', async () => {
    const { client, onboarding } = await createFixture({
      employees: [
        { botId: 'bot_1', id: 'employee_1', legalName: 'One' },
        { botId: 'bot_2', id: 'employee_2', legalName: 'Two' },
      ],
    });
    const createdAt = new Date('2026-07-28T04:00:00.000Z');
    await client.db.insert(botWecomBindings).values({
      botInstanceId: 'bot_2',
      createdAt,
      employeeId: 'employee_2',
      updatedAt: createdAt,
      wecomUserId: 'occupied_user',
    });

    await expect(claimAndBind(onboarding, {
      submittedName: 'One',
      wecomUserId: 'occupied_user',
    })).resolves.toMatchObject({ outcome: 'userid_conflict' });
    await expect(claimAndBind(onboarding, {
      submittedName: 'Two',
      wecomUserId: 'other_user',
    })).resolves.toMatchObject({ outcome: 'bot_conflict' });

    expect(client.db.select().from(botWecomBindings).all()).toEqual([
      expect.objectContaining({
        botInstanceId: 'bot_2',
        employeeId: 'employee_2',
        wecomUserId: 'occupied_user',
      }),
    ]);
  });

  it('adopts an exact existing binding without changing its identity', async () => {
    const { client, onboarding } = await createFixture({
      employees: [{ botId: 'bot_1', id: 'employee_1', legalName: 'One' }],
    });
    const createdAt = new Date('2026-07-28T05:00:00.000Z');
    await client.db.insert(botWecomBindings).values({
      botInstanceId: 'bot_1',
      createdAt,
      employeeId: 'employee_1',
      updatedAt: createdAt,
      wecomUserId: 'user_1',
    });

    await expect(claimAndBind(onboarding, {
      submittedName: 'One',
      wecomUserId: 'user_1',
    })).resolves.toMatchObject({
      outcome: 'already_bound',
      session: { botInstanceId: 'bot_1', employeeId: 'employee_1', status: 'bound' },
    });
    expect(client.db.select().from(botWecomBindings).all()).toHaveLength(1);
  });

  it('rolls back a binding unless its receipt can be completed in the same transaction', async () => {
    const { client, onboarding } = await createFixture({
      employees: [{ botId: 'bot_1', id: 'employee_1', legalName: 'One' }],
    });

    await expect(onboarding.bindByName({
      messageId: 'missing_receipt',
      submittedName: 'One',
      successResponse: 'binding succeeded',
      wecomUserId: 'user_1',
    })).rejects.toThrow('receipt is not claimable');

    expect(client.db.select().from(botWecomBindings).all()).toEqual([]);
    await expect(onboarding.listSessions()).resolves.toEqual([]);
  });

  it('starts a fresh prompt instead of restoring a binding deleted by an administrator', async () => {
    const { client, onboarding } = await createFixture({
      employees: [{ botId: 'bot_1', id: 'employee_1', legalName: 'One' }],
    });
    const boundAt = new Date('2026-07-28T06:00:00.000Z');
    await claimAndBind(onboarding, {
      boundAt,
      submittedName: 'One',
      wecomUserId: 'user_1',
    });
    client.db.delete(botWecomBindings)
      .where(eq(botWecomBindings.botInstanceId, 'bot_1'))
      .run();
    client.db.insert(wecomOnboardingSessions).values({
      botInstanceId: 'bot_1',
      boundAt,
      createdAt: boundAt,
      employeeId: 'employee_1',
      expiresAt: new Date(boundAt.getTime() + 15 * 60_000),
      lastPromptAt: boundAt,
      status: 'bound',
      updatedAt: boundAt,
      wecomUserId: 'user_1',
    }).run();

    const restartedAt = new Date(boundAt.getTime() + 1_000);
    await expect(onboarding.beginOrGetSession({
      now: restartedAt,
      wecomUserId: 'user_1',
    })).resolves.toMatchObject({
      created: true,
      session: {
        botInstanceId: null,
        boundAt: null,
        employeeId: null,
        status: 'awaiting_name',
      },
    });
    expect(client.db.select().from(botWecomBindings).all()).toEqual([]);
  });
});

interface EmployeeSeed {
  botId?: string;
  enabled?: boolean;
  id: string;
  legalName?: string;
  nickname?: string;
  skipBot?: boolean;
}

async function createFixture(input: { employees?: EmployeeSeed[] } = {}) {
  const client = createDatabaseClient({ url: ':memory:' });
  clients.push(client);
  migrateDatabase(client);
  const users = new UserRepository(client.db);
  const workspaces = new WorkspaceRepository(client.db);
  const bots = new BotInstanceRepository(client.db);
  const directory = new EmployeeDirectoryRepository(client.db);
  await users.create({ email: 'admin@example.com', id: 'admin', name: 'Admin' });
  await workspaces.create({ id: 'workspace_1', name: 'Workspace', ownerUserId: 'admin' });

  const botIds = Array.from(new Set(
    (input.employees ?? []).filter((entry) => entry.botId && !entry.skipBot)
      .map((entry) => entry.botId!),
  ));
  for (const botId of botIds) {
    await bots.create({
      desiredState: 'running',
      id: botId,
      model: 'test-model',
      name: botId,
      ownerUserId: 'admin',
      provider: 'test-provider',
      status: 'running',
      workspaceId: 'workspace_1',
    });
  }

  for (const employee of input.employees ?? []) {
    const legalName = employee.legalName ?? null;
    const nickname = employee.nickname ?? null;
    await directory.create({
      enabled: employee.enabled ?? true,
      id: employee.id,
      legalName,
      nickname,
      normalizedLegalName: legalName ? normalizeEmployeeLookupName(legalName) : null,
      normalizedNickname: nickname ? normalizeEmployeeLookupName(nickname) : null,
    });
    if (employee.botId) {
      await client.db.update(employeeDirectoryEntries)
        .set({ claimedBotInstanceId: employee.botId })
        .where(eq(employeeDirectoryEntries.id, employee.id));
    }
  }

  return {
    client,
    onboarding: new WecomOnboardingRepository(client.db),
  };
}

let nextBindingMessageId = 0;

async function claimAndBind(
  onboarding: WecomOnboardingRepository,
  input: Omit<
    Parameters<WecomOnboardingRepository['bindByName']>[0],
    'messageId' | 'successResponse'
  >,
) {
  nextBindingMessageId += 1;
  const messageId = `binding_message_${nextBindingMessageId}`;
  const now = input.now ?? input.boundAt;
  await onboarding.claimReceipt({
    messageId,
    now,
    wecomUserId: input.wecomUserId,
  });
  return onboarding.bindByName({
    ...input,
    messageId,
    successResponse: 'binding succeeded',
  });
}
