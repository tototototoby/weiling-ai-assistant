import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveBotInstancePaths } from '@weiling-ai/shared';

const BRIEFING_STATE_DIRECTORY = '.weiling';
const LEGACY_BRIEFING_STATE_DIRECTORY = '.gaozhiling';
const BRIEFING_STATE_FILE = 'morning-briefing.json';
const BRIEFING_CALENDAR_FILE = 'china-workdays-2026.json';
const BRIEFING_SCHEDULE_MARKER = '[WEILING:MORNING_BRIEFING:v1]';
const BRIEFING_SKILL_POLICY_VERSION = '2026.2';
const MAX_BRIEFING_STATE_BYTES = 1024 * 1024;
const DELIVERY_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export interface MorningBriefingPolicyRecordLike {
  botInstanceId: string;
  adminEnabled: boolean;
  location: string;
  deliveryTime: string;
  timezone: string;
  forceEnabled: boolean;
  observedUserOptOut: boolean;
  desiredRevision: number;
  appliedRevision: number;
  syncStatus: string;
  lastSyncError: string | null;
  lastSyncedAt: Date | null;
  runtimeNeedsCleanup: boolean;
  runtimeNeedsSchedule: boolean;
  runtimeObservedAt: Date | null;
  runtimeScheduledFor: string | null;
  runtimeScheduleTaskId: string | null;
}

export interface MorningBriefingPolicyRepositoryLike {
  ensureForAllBots(): Promise<unknown>;
  listAll(): Promise<MorningBriefingPolicyRecordLike[]>;
  markObservedUserOptOut(botInstanceId: string, userOptOut: boolean): Promise<unknown>;
  markSyncSucceeded(
    botInstanceId: string,
    input: {
      appliedRevision: number;
      observedUserOptOut: boolean;
      lastSyncedAt: Date;
      runtimeNeedsCleanup: boolean;
      runtimeNeedsSchedule: boolean;
      runtimeScheduledFor: string | null;
      runtimeScheduleTaskId: string | null;
    },
  ): Promise<unknown>;
  markSyncFailed(
    botInstanceId: string,
    input: { error: string; lastSyncedAt: Date },
  ): Promise<unknown>;
}

interface MorningBriefingWorkspaceState extends Record<string, unknown> {
  schemaVersion?: unknown;
  policyVersion?: unknown;
  adminPolicyRevision?: unknown;
  deliveryMode?: unknown;
  enabled?: unknown;
  userOptOut?: unknown;
  location?: unknown;
  time?: unknown;
  timezone?: unknown;
  calendarFile?: unknown;
  scheduleMarker?: unknown;
  scheduleTaskId?: unknown;
  scheduledFor?: unknown;
  needsSchedule?: unknown;
  needsCleanup?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MorningBriefingPolicyReconcilerDependencies {
  instancesRoot: string;
  policies: MorningBriefingPolicyRepositoryLike;
  logError?: (error: unknown) => void;
}

export class MorningBriefingPolicyReconciler {
  private isRunning = false;
  private readonly instancesRoot: string;
  private readonly logError: (error: unknown) => void;
  private readonly policies: MorningBriefingPolicyRepositoryLike;

  constructor(dependencies: MorningBriefingPolicyReconcilerDependencies) {
    this.instancesRoot = dependencies.instancesRoot;
    this.policies = dependencies.policies;
    this.logError = dependencies.logError ?? console.error;
  }

  async runOnce(now: Date = new Date()): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      await this.policies.ensureForAllBots();
      const policies = await this.policies.listAll();

      for (const policy of policies) {
        try {
          await this.reconcilePolicy(policy, now);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);

          try {
            await this.policies.markSyncFailed(policy.botInstanceId, {
              error: message,
              lastSyncedAt: now,
            });
          } catch (markError) {
            this.logError(markError);
          }

          this.logError(
            new Error(`Failed to sync morning briefing policy for ${policy.botInstanceId}: ${message}`),
          );
        }
      }
    } finally {
      this.isRunning = false;
    }
  }

  private async reconcilePolicy(
    policy: MorningBriefingPolicyRecordLike,
    now: Date,
  ): Promise<void> {
    validatePolicy(policy);
    const { workspaceDir } = resolveBotInstancePaths(this.instancesRoot, policy.botInstanceId);
    const stateDirectory = path.join(workspaceDir, BRIEFING_STATE_DIRECTORY);
    const stateFile = path.join(stateDirectory, BRIEFING_STATE_FILE);
    const legacyStateDirectory = path.join(workspaceDir, LEGACY_BRIEFING_STATE_DIRECTORY);
    const legacyStateFile = path.join(legacyStateDirectory, BRIEFING_STATE_FILE);
    await assertSafeStatePath(stateDirectory, stateFile);
    await assertSafeStatePath(legacyStateDirectory, legacyStateFile);

    const { existing, existingFile } = await readExistingState([stateFile, legacyStateFile]);
    const existingUserOptOut = existing?.userOptOut === true;
    const observedUserOptOut = policy.forceEnabled ? false : existingUserOptOut;

    if (policy.observedUserOptOut !== observedUserOptOut) {
      await this.policies.markObservedUserOptOut(policy.botInstanceId, observedUserOptOut);
    }

    const effectiveEnabled = policy.adminEnabled
      && (!observedUserOptOut || policy.forceEnabled);
    const timestamp = now.toISOString();
    const managedState = {
      schemaVersion: 1,
      policyVersion: BRIEFING_SKILL_POLICY_VERSION,
      adminPolicyRevision: policy.desiredRevision,
      deliveryMode: 'supervisor',
      enabled: effectiveEnabled,
      userOptOut: observedUserOptOut,
      location: policy.location,
      time: policy.deliveryTime,
      timezone: policy.timezone,
      calendarFile: BRIEFING_CALENDAR_FILE,
      scheduleMarker: BRIEFING_SCHEDULE_MARKER,
      needsSchedule: false,
      needsCleanup: false,
    };
    const managedStateChanged = !existing || Object.entries(managedState).some(
      ([key, value]) => existing[key] !== value,
    );
    const needsRelocation = existingFile !== null && existingFile !== stateFile;
    let reconciledState = existing;
    if (managedStateChanged || needsRelocation) {
      const nextState: MorningBriefingWorkspaceState = {
        ...(existing ?? {}),
        ...managedState,
        createdAt: typeof existing?.createdAt === 'string' ? existing.createdAt : timestamp,
        updatedAt: timestamp,
      };
      await atomicWriteJson(stateFile, nextState);
      reconciledState = nextState;
    }

    if (!reconciledState) {
      throw new Error(`Morning briefing state was not created: ${stateFile}`);
    }

    const runtime = readRuntimeObservation(reconciledState);
    const runtimeObservationChanged = policy.runtimeObservedAt === null
      || policy.runtimeNeedsCleanup !== runtime.runtimeNeedsCleanup
      || policy.runtimeNeedsSchedule !== runtime.runtimeNeedsSchedule
      || policy.runtimeScheduledFor !== runtime.runtimeScheduledFor
      || policy.runtimeScheduleTaskId !== runtime.runtimeScheduleTaskId;

    if (
      !runtimeObservationChanged
      && policy.appliedRevision === policy.desiredRevision
      && policy.syncStatus === 'synced'
      && policy.lastSyncError === null
      && policy.observedUserOptOut === observedUserOptOut
    ) {
      return;
    }

    await this.policies.markSyncSucceeded(policy.botInstanceId, {
      appliedRevision: policy.desiredRevision,
      observedUserOptOut,
      lastSyncedAt: now,
      ...runtime,
    });
  }
}

function readRuntimeObservation(state: MorningBriefingWorkspaceState) {
  const runtimeScheduleTaskId = readOptionalString(
    state.scheduleTaskId,
    'scheduleTaskId',
    200,
  );
  const runtimeScheduledFor = readOptionalString(state.scheduledFor, 'scheduledFor', 100);

  if (
    runtimeScheduledFor !== null
    && !Number.isFinite(Date.parse(runtimeScheduledFor))
  ) {
    throw new Error('Morning briefing scheduledFor must be an ISO date-time string.');
  }

  return {
    runtimeNeedsCleanup: state.needsCleanup === true,
    runtimeNeedsSchedule: state.needsSchedule === true,
    runtimeScheduledFor,
    runtimeScheduleTaskId,
  };
}

function readOptionalString(value: unknown, field: string, maxLength: number): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`Morning briefing ${field} is invalid.`);
  }

  return value;
}

async function readExistingState(filePaths: readonly string[]): Promise<{
  existing: MorningBriefingWorkspaceState | null;
  existingFile: string | null;
}> {
  for (const filePath of filePaths) {
    try {
      const source = await readFile(filePath, 'utf8');
      const value = JSON.parse(source) as unknown;

      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Morning briefing state must be a JSON object: ${filePath}`);
      }

      return {
        existing: value as MorningBriefingWorkspaceState,
        existingFile: filePath,
      };
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        continue;
      }

      if (error instanceof SyntaxError) {
        throw new Error(`Morning briefing state contains invalid JSON: ${filePath}`, { cause: error });
      }

      throw error;
    }
  }

  return { existing: null, existingFile: null };
}

async function assertSafeStatePath(directoryPath: string, filePath: string): Promise<void> {
  for (const candidate of [directoryPath, filePath]) {
    try {
      const stats = await lstat(candidate);

      if (stats.isSymbolicLink()) {
        throw new Error(`Morning briefing state path must not be a symbolic link: ${candidate}`);
      }

      if (candidate === directoryPath && !stats.isDirectory()) {
        throw new Error(`Morning briefing state directory is not a directory: ${candidate}`);
      }

      if (candidate === filePath && !stats.isFile()) {
        throw new Error(`Morning briefing state file is not a regular file: ${candidate}`);
      }

      if (candidate === filePath && stats.size > MAX_BRIEFING_STATE_BYTES) {
        throw new Error(
          `Morning briefing state exceeds ${MAX_BRIEFING_STATE_BYTES} bytes: ${candidate}`,
        );
      }
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        continue;
      }

      throw error;
    }
  }
}

async function atomicWriteJson(
  filePath: string,
  value: MorningBriefingWorkspaceState,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryFile = `${filePath}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryFile, filePath);
  } catch (error) {
    await rm(temporaryFile, { force: true }).catch(() => undefined);
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function validatePolicy(policy: MorningBriefingPolicyRecordLike): void {
  if (!policy.botInstanceId.trim()) {
    throw new Error('Morning briefing botInstanceId must not be empty.');
  }

  if (
    !policy.location.trim()
    || policy.location.length > 80
    || /[\r\n\0]/.test(policy.location)
  ) {
    throw new Error('Morning briefing location must be one line up to 80 characters.');
  }

  if (!DELIVERY_TIME_PATTERN.test(policy.deliveryTime)) {
    throw new Error('Morning briefing deliveryTime must use HH:mm in 24-hour time.');
  }

  if (policy.timezone !== 'Asia/Shanghai') {
    throw new Error('Morning briefing timezone must be Asia/Shanghai.');
  }

  if (!Number.isSafeInteger(policy.desiredRevision) || policy.desiredRevision < 0) {
    throw new Error('Morning briefing desiredRevision must be a non-negative integer.');
  }
}
