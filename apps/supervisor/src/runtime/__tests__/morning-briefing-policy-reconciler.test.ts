import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveBotInstancePaths } from '@weiling-ai/shared';
import {
  MorningBriefingPolicyReconciler,
  type MorningBriefingPolicyRecordLike,
  type MorningBriefingPolicyRepositoryLike,
} from '../morning-briefing-policy-reconciler';

const tempDirectories: string[] = [];
const now = new Date('2026-07-21T00:30:00.000Z');

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('MorningBriefingPolicyReconciler', () => {
  it('ensures policies and creates managed state for every bot', async () => {
    const { instancesRoot, stateFile } = await createWorkspace('bot_1');
    const repository = createRepository([createPolicy()]);
    const reconciler = new MorningBriefingPolicyReconciler({
      instancesRoot,
      policies: repository,
    });

    await reconciler.runOnce(now);

    const state = JSON.parse(await readFile(stateFile, 'utf8')) as Record<string, unknown>;
    expect(repository.ensureForAllBots).toHaveBeenCalledTimes(1);
    expect(state).toMatchObject({
      schemaVersion: 1,
      policyVersion: '2026.2',
      adminPolicyRevision: 3,
      deliveryMode: 'supervisor',
      enabled: true,
      userOptOut: false,
      location: '北京',
      time: '08:30',
      timezone: 'Asia/Shanghai',
      calendarFile: 'china-workdays-2026.json',
      scheduleMarker: '[WEILING:MORNING_BRIEFING:v1]',
      needsSchedule: false,
      needsCleanup: false,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    expect(repository.markSyncSucceeded).toHaveBeenCalledWith('bot_1', {
      appliedRevision: 3,
      observedUserOptOut: false,
      lastSyncedAt: now,
      runtimeNeedsCleanup: false,
      runtimeNeedsSchedule: false,
      runtimeScheduledFor: null,
      runtimeScheduleTaskId: null,
    });
  });

  it('relocates a legacy briefing state file to the weiling directory without deleting the source', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'weiling-morning-briefing-legacy-'));
    tempDirectories.push(root);
    const instancesRoot = path.join(root, 'instances');
    const { workspaceDir } = resolveBotInstancePaths(instancesRoot, 'bot_1');
    const legacyDirectory = path.join(workspaceDir, '.gaozhiling');
    const legacyStateFile = path.join(legacyDirectory, 'morning-briefing.json');
    const stateFile = path.join(workspaceDir, '.weiling', 'morning-briefing.json');
    await mkdir(legacyDirectory, { recursive: true });
    await writeFile(legacyStateFile, `${JSON.stringify({
      schemaVersion: 1,
      policyVersion: '2026.1',
      adminPolicyRevision: 2,
      enabled: true,
      userOptOut: false,
      location: '北京',
      time: '08:30',
      timezone: 'Asia/Shanghai',
      calendarFile: 'china-workdays-2026.json',
      scheduleMarker: '[GAOZHILING:MORNING_BRIEFING:v1]',
      createdAt: '2026-07-01T00:00:00.000Z',
    })}\n`);
    const repository = createRepository([createPolicy()]);

    await new MorningBriefingPolicyReconciler({ instancesRoot, policies: repository }).runOnce(now);

    await expect(readFile(stateFile, 'utf8')).resolves.toContain('[WEILING:MORNING_BRIEFING:v1]');
    await expect(readFile(legacyStateFile, 'utf8')).resolves.toContain('[GAOZHILING:MORNING_BRIEFING:v1]');
  });

  it('preserves runtime fields and respects an employee opt-out', async () => {
    const { instancesRoot, stateFile } = await createWorkspace('bot_1');
    await writeFile(stateFile, `${JSON.stringify({
      schemaVersion: 1,
      policyVersion: '2026.1',
      adminPolicyRevision: 2,
      enabled: true,
      userOptOut: true,
      location: '泉州',
      time: '09:00',
      timezone: 'Asia/Shanghai',
      calendarFile: 'china-workdays-2026.json',
      scheduleMarker: '[WEILING:MORNING_BRIEFING:v1]',
      scheduleTaskId: 'cron_123',
      scheduledFor: '2026-07-22T08:30:00+08:00',
      createdAt: '2026-07-01T00:00:00.000Z',
      privateRuntimeField: 'preserved',
    }, null, 2)}\n`);
    const repository = createRepository([createPolicy({
      observedUserOptOut: false,
      desiredRevision: 4,
    })]);

    await new MorningBriefingPolicyReconciler({
      instancesRoot,
      policies: repository,
    }).runOnce(now);

    const state = JSON.parse(await readFile(stateFile, 'utf8')) as Record<string, unknown>;
    expect(state).toMatchObject({
      enabled: false,
      deliveryMode: 'supervisor',
      userOptOut: true,
      scheduleTaskId: 'cron_123',
      scheduledFor: '2026-07-22T08:30:00+08:00',
      privateRuntimeField: 'preserved',
      needsSchedule: false,
      needsCleanup: false,
      createdAt: '2026-07-01T00:00:00.000Z',
    });
    expect(repository.markObservedUserOptOut).toHaveBeenCalledWith('bot_1', true);
    expect(repository.markSyncSucceeded).toHaveBeenCalledWith('bot_1', {
      appliedRevision: 4,
      observedUserOptOut: true,
      lastSyncedAt: now,
      runtimeNeedsCleanup: false,
      runtimeNeedsSchedule: false,
      runtimeScheduledFor: '2026-07-22T08:30:00+08:00',
      runtimeScheduleTaskId: 'cron_123',
    });
  });

  it('clears an employee opt-out when the administrator force-enables the policy', async () => {
    const { instancesRoot, stateFile } = await createWorkspace('bot_1');
    await writeFile(stateFile, `${JSON.stringify({
      schemaVersion: 1,
      policyVersion: '2026.1',
      adminPolicyRevision: 2,
      enabled: false,
      userOptOut: true,
      location: '北京',
      time: '08:30',
      timezone: 'Asia/Shanghai',
      calendarFile: 'china-workdays-2026.json',
      scheduleMarker: '[WEILING:MORNING_BRIEFING:v1]',
      scheduleTaskId: 'cron_old',
      createdAt: '2026-07-01T00:00:00.000Z',
    })}\n`);
    const repository = createRepository([createPolicy({
      forceEnabled: true,
      observedUserOptOut: true,
      desiredRevision: 5,
    })]);

    await new MorningBriefingPolicyReconciler({
      instancesRoot,
      policies: repository,
    }).runOnce(now);

    const state = JSON.parse(await readFile(stateFile, 'utf8')) as Record<string, unknown>;
    expect(state).toMatchObject({
      enabled: true,
      deliveryMode: 'supervisor',
      userOptOut: false,
      needsSchedule: false,
      needsCleanup: false,
    });
    expect(repository.markObservedUserOptOut).toHaveBeenCalledWith('bot_1', false);
  });

  it('leaves runtime reconciliation flags unchanged when managed state already matches', async () => {
    const { instancesRoot, stateFile } = await createWorkspace('bot_1');
    await writeFile(stateFile, `${JSON.stringify({
      schemaVersion: 1,
      policyVersion: '2026.2',
      adminPolicyRevision: 3,
      deliveryMode: 'supervisor',
      enabled: true,
      userOptOut: false,
      location: '北京',
      time: '08:30',
      timezone: 'Asia/Shanghai',
      calendarFile: 'china-workdays-2026.json',
      scheduleMarker: '[WEILING:MORNING_BRIEFING:v1]',
      scheduleTaskId: 'cron_current',
      scheduledFor: '2026-07-22T08:30:00+08:00',
      needsSchedule: false,
      needsCleanup: false,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
    })}\n`);
    const repository = createRepository([createPolicy({
      appliedRevision: 3,
      runtimeNeedsCleanup: false,
      runtimeNeedsSchedule: false,
      runtimeObservedAt: now,
      runtimeScheduledFor: '2026-07-22T08:30:00+08:00',
      runtimeScheduleTaskId: 'cron_current',
      syncStatus: 'synced',
    })]);

    await new MorningBriefingPolicyReconciler({
      instancesRoot,
      policies: repository,
    }).runOnce(now);

    const state = JSON.parse(await readFile(stateFile, 'utf8')) as Record<string, unknown>;
    expect(state).toMatchObject({
      scheduleTaskId: 'cron_current',
      needsSchedule: false,
      needsCleanup: false,
      updatedAt: '2026-07-20T00:00:00.000Z',
    });
    expect(repository.markSyncSucceeded).not.toHaveBeenCalled();
  });

  it('observes a cron task registered by the active Weixin session', async () => {
    const { instancesRoot, stateFile } = await createWorkspace('bot_1');
    await writeFile(stateFile, `${JSON.stringify({
      schemaVersion: 1,
      policyVersion: '2026.1',
      adminPolicyRevision: 3,
      enabled: true,
      userOptOut: false,
      location: '北京',
      time: '08:30',
      timezone: 'Asia/Shanghai',
      calendarFile: 'china-workdays-2026.json',
      scheduleMarker: '[WEILING:MORNING_BRIEFING:v1]',
      scheduleTaskId: 'cron_registered',
      scheduledFor: '2026-07-22T08:30:00+08:00',
      needsSchedule: false,
      needsCleanup: false,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
    })}\n`);
    const repository = createRepository([createPolicy({
      appliedRevision: 3,
      runtimeNeedsSchedule: true,
      runtimeObservedAt: new Date('2026-07-20T00:00:00.000Z'),
      syncStatus: 'synced',
    })]);

    await new MorningBriefingPolicyReconciler({
      instancesRoot,
      policies: repository,
    }).runOnce(now);

    expect(repository.markSyncSucceeded).toHaveBeenCalledWith('bot_1', {
      appliedRevision: 3,
      lastSyncedAt: now,
      observedUserOptOut: false,
      runtimeNeedsCleanup: false,
      runtimeNeedsSchedule: false,
      runtimeScheduledFor: '2026-07-22T08:30:00+08:00',
      runtimeScheduleTaskId: 'cron_registered',
    });
  });

  it('records one bot failure and continues syncing the remaining policies', async () => {
    const first = await createWorkspace('bot_bad');
    const { stateFile: secondStateFile } = await createWorkspaceInRoot(
      first.instancesRoot,
      'bot_good',
    );
    await writeFile(first.stateFile, '{ invalid json');
    const repository = createRepository([
      createPolicy({ botInstanceId: 'bot_bad' }),
      createPolicy({ botInstanceId: 'bot_good' }),
    ]);
    const logError = vi.fn<(error: unknown) => void>();

    await new MorningBriefingPolicyReconciler({
      instancesRoot: first.instancesRoot,
      policies: repository,
      logError,
    }).runOnce(now);

    await expect(readFile(secondStateFile, 'utf8')).resolves.toContain('"enabled": true');
    expect(repository.markSyncFailed).toHaveBeenCalledWith('bot_bad', {
      error: expect.stringContaining('invalid JSON'),
      lastSyncedAt: now,
    });
    expect(repository.markSyncSucceeded).toHaveBeenCalledWith(
      'bot_good',
      expect.objectContaining({ appliedRevision: 3 }),
    );
    expect(logError).toHaveBeenCalledTimes(1);
  });
});

function createPolicy(
  overrides: Partial<MorningBriefingPolicyRecordLike> = {},
): MorningBriefingPolicyRecordLike {
  return {
    botInstanceId: 'bot_1',
    adminEnabled: true,
    location: '北京',
    deliveryTime: '08:30',
    timezone: 'Asia/Shanghai',
    forceEnabled: false,
    observedUserOptOut: false,
    desiredRevision: 3,
    appliedRevision: 2,
    syncStatus: 'pending',
    lastSyncError: null,
    lastSyncedAt: null,
    runtimeNeedsCleanup: false,
    runtimeNeedsSchedule: false,
    runtimeObservedAt: null,
    runtimeScheduledFor: null,
    runtimeScheduleTaskId: null,
    ...overrides,
  };
}

function createRepository(
  policies: MorningBriefingPolicyRecordLike[],
): MorningBriefingPolicyRepositoryLike & {
  ensureForAllBots: ReturnType<typeof vi.fn>;
  markObservedUserOptOut: ReturnType<typeof vi.fn>;
  markSyncSucceeded: ReturnType<typeof vi.fn>;
  markSyncFailed: ReturnType<typeof vi.fn>;
} {
  return {
    ensureForAllBots: vi.fn().mockResolvedValue(undefined),
    listAll: vi.fn().mockResolvedValue(policies),
    markObservedUserOptOut: vi.fn().mockResolvedValue(undefined),
    markSyncSucceeded: vi.fn().mockResolvedValue(undefined),
    markSyncFailed: vi.fn().mockResolvedValue(undefined),
  };
}

async function createWorkspace(botInstanceId: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'weiling-morning-briefing-'));
  tempDirectories.push(root);
  const instancesRoot = path.join(root, 'instances');
  return {
    instancesRoot,
    ...await createWorkspaceInRoot(instancesRoot, botInstanceId),
  };
}

async function createWorkspaceInRoot(instancesRoot: string, botInstanceId: string) {
  const { workspaceDir } = resolveBotInstancePaths(instancesRoot, botInstanceId);
  const stateDirectory = path.join(workspaceDir, '.weiling');
  const stateFile = path.join(stateDirectory, 'morning-briefing.json');
  await mkdir(stateDirectory, { recursive: true });
  return { stateFile };
}
