const DEFAULT_POOL_SIZE = 1;
const DEFAULT_MIN_READY_PROCESSES = 1;
const DEFAULT_SESSION_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_CONCURRENT_INIT = 1;
const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 60_000;
const DEFAULT_PORT_BASE = 31_000;
const DEFAULT_PROXY_PORT_BASE = 9_100;
const DEFAULT_PORT_RANGE_WIDTH = 100;
const DEFAULT_WORKSPACE_BASE_ROOT = '/app/apps/sandbox-runtime/user-workspaces';
const DEFAULT_ALLOW_WRITE = '/tmp';
const DEFAULT_DENY_READ_PATHS = [
  '/etc/passwd',
  '/etc/passwd-',
  '/etc/shadow',
  '/etc/shadow-',
  '/etc/group',
  '/etc/group-',
  '/etc/gshadow',
  '/etc/gshadow-',
  '/proc/self/mountinfo',
  '/proc/*/mountinfo',
  '/proc/self/mounts',
  '/proc/*/mounts',
  '/proc/mounts',
  '/proc/self/mountstats',
  '/proc/*/mountstats',
  '/proc/self/cmdline',
  '/proc/1/cmdline',
  '/proc/*/cmdline',
  '/proc/self/environ',
  '/proc/1/environ',
  '/proc/*/environ',
  '/proc/kallsyms',
  '/proc/self/cgroup',
  '/proc/*/cgroup',
  '/proc/cgroups',
  '/root',
  '~/.ssh',
  '~/.aws',
] as const;
const DEFAULT_DENY_READ = DEFAULT_DENY_READ_PATHS.join(',');
const DEFAULT_DENY_WRITE = '.env,~/.ssh,~/.aws';
const PROXY_PORTS_PER_WORKER = 2;
const FATAL_LINUX_DENY_READ_PATHS = new Set([
  '/etc/mtab',
]);

export const SRT_POOL_CONFIG_FILE_VERSION = 2;
export const SRT_POOL_STATUS_FILE_VERSION = 2;

export type SandboxRuntimePoolState = 'starting' | 'running' | 'degraded' | 'stopped' | 'failed';

export interface SandboxRuntimePoolDefaults {
  defaultAllowRead: string[];
  defaultAllowWrite: string[];
  defaultDeniedDomains: string[];
  defaultDenyRead: string[];
  defaultDenyWrite: string[];
  healthCheckIntervalMs: number;
  maxConcurrentInit: number;
  minReadyProcesses: number;
  poolSize: number;
  portBase: number;
  portRangeWidth: number;
  proxyPortBase: number;
  sessionTimeoutMs: number;
  workspaceBaseRoot: string;
}

export function normalizeSandboxRuntimeDenyReadPaths(paths: readonly string[]): string[] {
  const nextPaths: string[] = [];
  const seenPaths = new Set<string>();

  for (const path of paths) {
    const normalizedPath = path.trim();

    if (normalizedPath.length === 0 || FATAL_LINUX_DENY_READ_PATHS.has(normalizedPath) || seenPaths.has(normalizedPath)) {
      continue;
    }

    seenPaths.add(normalizedPath);
    nextPaths.push(normalizedPath);
  }

  return nextPaths;
}

export function parseSandboxRuntimePoolDefaults(
  env: Record<string, string | undefined>,
): SandboxRuntimePoolDefaults {
  const poolSize = parsePositiveInteger(env.SRT_DEFAULT_POOL_SIZE, 'SRT_DEFAULT_POOL_SIZE', DEFAULT_POOL_SIZE);
  const minReadyProcesses = parsePositiveInteger(
    env.SRT_DEFAULT_MIN_READY_PROCESSES,
    'SRT_DEFAULT_MIN_READY_PROCESSES',
    DEFAULT_MIN_READY_PROCESSES,
  );
  const portRangeWidth = parsePositiveInteger(
    env.SRT_DEFAULT_PORT_RANGE_WIDTH,
    'SRT_DEFAULT_PORT_RANGE_WIDTH',
    DEFAULT_PORT_RANGE_WIDTH,
  );

  if (minReadyProcesses > poolSize) {
    throw new Error('SRT_DEFAULT_MIN_READY_PROCESSES must be <= SRT_DEFAULT_POOL_SIZE.');
  }

  if (portRangeWidth < poolSize * PROXY_PORTS_PER_WORKER) {
    throw new Error('SRT_DEFAULT_PORT_RANGE_WIDTH must be at least SRT_DEFAULT_POOL_SIZE * 2.');
  }

  return {
    defaultAllowRead: parseCommaList(env.SRT_DEFAULT_ALLOW_READ),
    defaultAllowWrite: parseCommaList(env.SRT_DEFAULT_ALLOW_WRITE ?? DEFAULT_ALLOW_WRITE),
    defaultDeniedDomains: parseCommaList(env.SRT_DEFAULT_DENIED_DOMAINS),
    defaultDenyRead: normalizeSandboxRuntimeDenyReadPaths(
      parseCommaList(env.SRT_DEFAULT_DENY_READ ?? DEFAULT_DENY_READ),
    ),
    defaultDenyWrite: parseCommaList(env.SRT_DEFAULT_DENY_WRITE ?? DEFAULT_DENY_WRITE),
    healthCheckIntervalMs: parsePositiveInteger(
      env.SRT_DEFAULT_HEALTH_CHECK_INTERVAL_MS,
      'SRT_DEFAULT_HEALTH_CHECK_INTERVAL_MS',
      DEFAULT_HEALTH_CHECK_INTERVAL_MS,
    ),
    maxConcurrentInit: parsePositiveInteger(
      env.SRT_DEFAULT_MAX_CONCURRENT_INIT,
      'SRT_DEFAULT_MAX_CONCURRENT_INIT',
      DEFAULT_MAX_CONCURRENT_INIT,
    ),
    minReadyProcesses,
    poolSize,
    portBase: parsePositiveInteger(env.SRT_PORT_BASE, 'SRT_PORT_BASE', DEFAULT_PORT_BASE),
    portRangeWidth,
    proxyPortBase: parsePositiveInteger(env.SRT_PROXY_PORT_BASE, 'SRT_PROXY_PORT_BASE', DEFAULT_PROXY_PORT_BASE),
    sessionTimeoutMs: parsePositiveInteger(
      env.SRT_DEFAULT_SESSION_TIMEOUT_MS,
      'SRT_DEFAULT_SESSION_TIMEOUT_MS',
      DEFAULT_SESSION_TIMEOUT_MS,
    ),
    workspaceBaseRoot: parseNonEmptyString(
      env.SRT_WORKSPACE_BASE_ROOT,
      'SRT_WORKSPACE_BASE_ROOT',
      DEFAULT_WORKSPACE_BASE_ROOT,
    ),
  };
}

function parsePositiveInteger(value: string | undefined, name: string, defaultValue: number): number {
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }

  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`${name} must be a positive integer.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function parseNonEmptyString(value: string | undefined, name: string, defaultValue: string): string {
  const parsed = value?.trim() ?? defaultValue;
  if (parsed.length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }

  return parsed;
}

function parseCommaList(value: string | undefined): string[] {
  if (value === undefined || value.trim() === '') {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
