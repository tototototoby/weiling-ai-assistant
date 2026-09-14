import { randomBytes, randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import type { SandboxRuntimePoolDefaults } from '@weiling-ai/shared';
import { asc, eq, ne } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../schema/index';
import { userSandboxRuntimePools } from '../schema/user-sandbox-runtime-pools';

type Db = BetterSQLite3Database<typeof schema>;
type UserSandboxRuntimePoolRow = typeof userSandboxRuntimePools.$inferSelect;

const API_KEY_BYTES = 32;
const PROXY_PORTS_PER_WORKER = 2;
const SAFE_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface UserSandboxRuntimePoolRecord {
  apiKey: string;
  createdAt: Date;
  defaultAllowRead: string[];
  defaultAllowWrite: string[];
  defaultDeniedDomains: string[];
  defaultDenyRead: string[];
  defaultDenyWrite: string[];
  enabled: boolean;
  healthCheckIntervalMs: number;
  id: string;
  maxConcurrentInit: number;
  minReadyProcesses: number;
  ownerUserId: string;
  poolSize: number;
  port: number;
  portRangeEnd: number;
  portRangeStart: number;
  restartRequestedAt: Date | null;
  sessionTimeoutMs: number;
  updatedAt: Date;
  workspaceBasePath: string;
}

export interface EnsureUserSandboxRuntimePoolInput {
  defaults: SandboxRuntimePoolDefaults;
  now?: Date;
  ownerUserId: string;
}

export interface UpdateUserSandboxRuntimePoolInput {
  defaultAllowRead?: string[];
  defaultAllowWrite?: string[];
  defaultDeniedDomains?: string[];
  defaultDenyRead?: string[];
  defaultDenyWrite?: string[];
  enabled?: boolean;
  healthCheckIntervalMs?: number;
  maxConcurrentInit?: number;
  minReadyProcesses?: number;
  poolSize?: number;
  port?: number;
  portRangeEnd?: number;
  portRangeStart?: number;
  sessionTimeoutMs?: number;
  updatedAt?: Date;
  workspaceBasePath?: string;
}

export class UserSandboxRuntimePoolRepository {
  constructor(private readonly db: Db) {}

  async ensureForUser(input: EnsureUserSandboxRuntimePoolInput): Promise<UserSandboxRuntimePoolRecord> {
    return this.db.transaction((tx) => {
      const existing = tx.select()
        .from(userSandboxRuntimePools)
        .where(eq(userSandboxRuntimePools.ownerUserId, input.ownerUserId))
        .get();

      if (existing) {
        return mapRow(existing);
      }

      assertSafePathSegment(input.ownerUserId, 'ownerUserId');
      validateCapacity({
        minReadyProcesses: input.defaults.minReadyProcesses,
        poolSize: input.defaults.poolSize,
        portRangeEnd: input.defaults.proxyPortBase + input.defaults.portRangeWidth - 1,
        portRangeStart: input.defaults.proxyPortBase,
      });

      const existingPools = tx.select()
        .from(userSandboxRuntimePools)
        .orderBy(asc(userSandboxRuntimePools.port))
        .all();
      const port = allocatePort(input.defaults.portBase, existingPools);
      const portRangeStart = allocateProxyPortRange(input.defaults, existingPools);
      const portRangeEnd = portRangeStart + input.defaults.portRangeWidth - 1;
      const now = input.now ?? new Date();

      tx.insert(userSandboxRuntimePools).values({
        apiKey: randomBytes(API_KEY_BYTES).toString('hex'),
        createdAt: now,
        defaultAllowReadJson: stringifyStringArray(input.defaults.defaultAllowRead),
        defaultAllowWriteJson: stringifyStringArray(input.defaults.defaultAllowWrite),
        defaultDeniedDomainsJson: stringifyStringArray(input.defaults.defaultDeniedDomains),
        defaultDenyReadJson: stringifyStringArray(input.defaults.defaultDenyRead),
        defaultDenyWriteJson: stringifyStringArray(input.defaults.defaultDenyWrite),
        enabled: true,
        healthCheckIntervalMs: input.defaults.healthCheckIntervalMs,
        id: randomUUID(),
        maxConcurrentInit: input.defaults.maxConcurrentInit,
        minReadyProcesses: input.defaults.minReadyProcesses,
        ownerUserId: input.ownerUserId,
        poolSize: input.defaults.poolSize,
        port,
        portRangeEnd,
        portRangeStart,
        restartRequestedAt: null,
        sessionTimeoutMs: input.defaults.sessionTimeoutMs,
        updatedAt: now,
        workspaceBasePath: posix.join(input.defaults.workspaceBaseRoot, input.ownerUserId),
      }).run();

      const created = tx.select()
        .from(userSandboxRuntimePools)
        .where(eq(userSandboxRuntimePools.ownerUserId, input.ownerUserId))
        .get();

      if (!created) {
        throw new Error('Failed to create SRT pool.');
      }

      return mapRow(created);
    }, { behavior: 'immediate' });
  }

  async findByOwnerUserId(ownerUserId: string): Promise<UserSandboxRuntimePoolRecord | null> {
    const row = this.db.select()
      .from(userSandboxRuntimePools)
      .where(eq(userSandboxRuntimePools.ownerUserId, ownerUserId))
      .get();

    return row ? mapRow(row) : null;
  }

  async listAll(): Promise<UserSandboxRuntimePoolRecord[]> {
    return this.db.select()
      .from(userSandboxRuntimePools)
      .orderBy(asc(userSandboxRuntimePools.ownerUserId))
      .all()
      .map(mapRow);
  }

  async updateByOwnerUserId(
    ownerUserId: string,
    input: UpdateUserSandboxRuntimePoolInput,
  ): Promise<UserSandboxRuntimePoolRecord | null> {
    return this.db.transaction((tx) => {
      const current = tx.select()
        .from(userSandboxRuntimePools)
        .where(eq(userSandboxRuntimePools.ownerUserId, ownerUserId))
        .get();

      if (!current) {
        return null;
      }

      const next = {
        defaultAllowRead: input.defaultAllowRead ?? parseStringArray(current.defaultAllowReadJson),
        defaultAllowWrite: input.defaultAllowWrite ?? parseStringArray(current.defaultAllowWriteJson),
        defaultDeniedDomains: input.defaultDeniedDomains ?? parseStringArray(current.defaultDeniedDomainsJson),
        defaultDenyRead: input.defaultDenyRead ?? parseStringArray(current.defaultDenyReadJson),
        defaultDenyWrite: input.defaultDenyWrite ?? parseStringArray(current.defaultDenyWriteJson),
        enabled: input.enabled ?? current.enabled,
        healthCheckIntervalMs: input.healthCheckIntervalMs ?? current.healthCheckIntervalMs,
        maxConcurrentInit: input.maxConcurrentInit ?? current.maxConcurrentInit,
        minReadyProcesses: input.minReadyProcesses ?? current.minReadyProcesses,
        poolSize: input.poolSize ?? current.poolSize,
        port: input.port ?? current.port,
        portRangeEnd: input.portRangeEnd ?? current.portRangeEnd,
        portRangeStart: input.portRangeStart ?? current.portRangeStart,
        sessionTimeoutMs: input.sessionTimeoutMs ?? current.sessionTimeoutMs,
        updatedAt: input.updatedAt ?? new Date(),
        workspaceBasePath: input.workspaceBasePath ?? current.workspaceBasePath,
      };

      validatePositiveInteger(next.healthCheckIntervalMs, 'SRT pool healthCheckIntervalMs');
      validatePositiveInteger(next.maxConcurrentInit, 'SRT pool maxConcurrentInit');
      validatePositiveInteger(next.port, 'SRT pool port');
      validatePositiveInteger(next.sessionTimeoutMs, 'SRT pool sessionTimeoutMs');
      validateCapacity(next);

      const otherPools = tx.select()
        .from(userSandboxRuntimePools)
        .where(ne(userSandboxRuntimePools.ownerUserId, ownerUserId))
        .all();

      const portCollision = otherPools.some((pool) => pool.port === next.port);

      if (portCollision) {
        throw new Error('SRT pool port is already used by another pool.');
      }

      const overlapping = otherPools.some((pool) => (
        rangesOverlap(pool.portRangeStart, pool.portRangeEnd, next.portRangeStart, next.portRangeEnd)
      ));

      if (overlapping) {
        throw new Error('SRT pool proxy port range overlaps another pool.');
      }

      tx.update(userSandboxRuntimePools)
        .set({
          defaultAllowReadJson: stringifyStringArray(next.defaultAllowRead),
          defaultAllowWriteJson: stringifyStringArray(next.defaultAllowWrite),
          defaultDeniedDomainsJson: stringifyStringArray(next.defaultDeniedDomains),
          defaultDenyReadJson: stringifyStringArray(next.defaultDenyRead),
          defaultDenyWriteJson: stringifyStringArray(next.defaultDenyWrite),
          enabled: next.enabled,
          healthCheckIntervalMs: next.healthCheckIntervalMs,
          maxConcurrentInit: next.maxConcurrentInit,
          minReadyProcesses: next.minReadyProcesses,
          poolSize: next.poolSize,
          port: next.port,
          portRangeEnd: next.portRangeEnd,
          portRangeStart: next.portRangeStart,
          sessionTimeoutMs: next.sessionTimeoutMs,
          updatedAt: next.updatedAt,
          workspaceBasePath: next.workspaceBasePath,
        })
        .where(eq(userSandboxRuntimePools.ownerUserId, ownerUserId))
        .run();

      const updated = tx.select()
        .from(userSandboxRuntimePools)
        .where(eq(userSandboxRuntimePools.ownerUserId, ownerUserId))
        .get();

      return updated ? mapRow(updated) : null;
    }, { behavior: 'immediate' });
  }

  async requestRestart(ownerUserId: string, restartedAt: Date = new Date()): Promise<UserSandboxRuntimePoolRecord | null> {
    this.db.update(userSandboxRuntimePools)
      .set({
        restartRequestedAt: restartedAt,
        updatedAt: restartedAt,
      })
      .where(eq(userSandboxRuntimePools.ownerUserId, ownerUserId))
      .run();

    return this.findByOwnerUserId(ownerUserId);
  }
}

function allocatePort(portBase: number, existingPools: UserSandboxRuntimePoolRow[]): number {
  const usedPorts = new Set(existingPools.map((pool) => pool.port));
  let nextPort = portBase;

  while (usedPorts.has(nextPort)) {
    nextPort += 1;
  }

  return nextPort;
}

function allocateProxyPortRange(
  defaults: SandboxRuntimePoolDefaults,
  existingPools: UserSandboxRuntimePoolRow[],
): number {
  let nextStart = defaults.proxyPortBase;
  let nextEnd = nextStart + defaults.portRangeWidth - 1;

  while (existingPools.some((pool) => rangesOverlap(pool.portRangeStart, pool.portRangeEnd, nextStart, nextEnd))) {
    nextStart += defaults.portRangeWidth;
    nextEnd = nextStart + defaults.portRangeWidth - 1;
  }

  return nextStart;
}

function assertSafePathSegment(value: string, name: string): void {
  if (!SAFE_PATH_SEGMENT_PATTERN.test(value)) {
    throw new Error(`${name} must be a safe path segment.`);
  }
}

function mapRow(row: UserSandboxRuntimePoolRow): UserSandboxRuntimePoolRecord {
  return {
    apiKey: row.apiKey,
    createdAt: row.createdAt,
    defaultAllowRead: parseStringArray(row.defaultAllowReadJson),
    defaultAllowWrite: parseStringArray(row.defaultAllowWriteJson),
    defaultDeniedDomains: parseStringArray(row.defaultDeniedDomainsJson),
    defaultDenyRead: parseStringArray(row.defaultDenyReadJson),
    defaultDenyWrite: parseStringArray(row.defaultDenyWriteJson),
    enabled: row.enabled,
    healthCheckIntervalMs: row.healthCheckIntervalMs,
    id: row.id,
    maxConcurrentInit: row.maxConcurrentInit,
    minReadyProcesses: row.minReadyProcesses,
    ownerUserId: row.ownerUserId,
    poolSize: row.poolSize,
    port: row.port,
    portRangeEnd: row.portRangeEnd,
    portRangeStart: row.portRangeStart,
    restartRequestedAt: row.restartRequestedAt,
    sessionTimeoutMs: row.sessionTimeoutMs,
    updatedAt: row.updatedAt,
    workspaceBasePath: row.workspaceBasePath,
  };
}

function parseStringArray(raw: string): string[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error('SRT pool JSON array field is invalid.');
  }

  return parsed;
}

function rangesOverlap(firstStart: number, firstEnd: number, secondStart: number, secondEnd: number): boolean {
  return firstStart <= secondEnd && firstEnd >= secondStart;
}

function stringifyStringArray(value: string[]): string {
  return JSON.stringify(value);
}

function validateCapacity(input: {
  minReadyProcesses: number;
  poolSize: number;
  portRangeEnd: number;
  portRangeStart: number;
}): void {
  validatePositiveInteger(input.poolSize, 'SRT pool poolSize');
  validatePositiveInteger(input.minReadyProcesses, 'SRT pool minReadyProcesses');
  validatePositiveInteger(input.portRangeStart, 'SRT pool portRangeStart');
  validatePositiveInteger(input.portRangeEnd, 'SRT pool portRangeEnd');

  if (input.minReadyProcesses > input.poolSize) {
    throw new Error('SRT pool minReadyProcesses must be <= poolSize.');
  }

  if (input.portRangeEnd < input.portRangeStart) {
    throw new Error('SRT pool portRangeEnd must be >= portRangeStart.');
  }

  if (input.portRangeEnd - input.portRangeStart + 1 < input.poolSize * PROXY_PORTS_PER_WORKER) {
    throw new Error('SRT pool proxy port range must cover poolSize * 2 ports.');
  }
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
}
