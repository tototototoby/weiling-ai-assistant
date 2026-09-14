import { describe, expect, it } from 'vitest';

import {
  normalizeSandboxRuntimeDenyReadPaths,
  parseSandboxRuntimePoolDefaults,
  SRT_POOL_CONFIG_FILE_VERSION,
  SRT_POOL_STATUS_FILE_VERSION,
} from '../sandbox-runtime-pools';

describe('parseSandboxRuntimePoolDefaults', () => {
  it('parses approved per-Bot sandbox runtime pool defaults', () => {
    expect(parseSandboxRuntimePoolDefaults({})).toEqual({
      defaultAllowRead: [],
      defaultAllowWrite: ['/tmp'],
      defaultDeniedDomains: [],
      defaultDenyRead: [
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
      ],
      defaultDenyWrite: ['.env', '~/.ssh', '~/.aws'],
      healthCheckIntervalMs: 60_000,
      maxConcurrentInit: 1,
      minReadyProcesses: 1,
      poolSize: 1,
      portBase: 31_000,
      portRangeWidth: 100,
      proxyPortBase: 9_100,
      sessionTimeoutMs: 600_000,
      workspaceBaseRoot: '/app/apps/sandbox-runtime/user-workspaces',
    });
    expect(SRT_POOL_CONFIG_FILE_VERSION).toBe(2);
    expect(SRT_POOL_STATUS_FILE_VERSION).toBe(2);
  });

  it('parses env overrides and trims comma separated lists', () => {
    expect(parseSandboxRuntimePoolDefaults({
      SRT_DEFAULT_ALLOW_READ: '/workspace, /state ,,',
      SRT_DEFAULT_ALLOW_WRITE: '/tmp,/workspace/output',
      SRT_DEFAULT_DENIED_DOMAINS: 'example.com, api.example.com',
      SRT_DEFAULT_DENY_READ: '/etc/passwd',
      SRT_DEFAULT_DENY_WRITE: '.env',
      SRT_DEFAULT_HEALTH_CHECK_INTERVAL_MS: '30000',
      SRT_DEFAULT_MAX_CONCURRENT_INIT: '2',
      SRT_DEFAULT_MIN_READY_PROCESSES: '2',
      SRT_DEFAULT_POOL_SIZE: '5',
      SRT_DEFAULT_PORT_RANGE_WIDTH: '200',
      SRT_DEFAULT_SESSION_TIMEOUT_MS: '900000',
      SRT_PORT_BASE: '32000',
      SRT_PROXY_PORT_BASE: '10000',
      SRT_WORKSPACE_BASE_ROOT: '/sandbox-workspaces',
    })).toEqual({
      defaultAllowRead: ['/workspace', '/state'],
      defaultAllowWrite: ['/tmp', '/workspace/output'],
      defaultDeniedDomains: ['example.com', 'api.example.com'],
      defaultDenyRead: ['/etc/passwd'],
      defaultDenyWrite: ['.env'],
      healthCheckIntervalMs: 30_000,
      maxConcurrentInit: 2,
      minReadyProcesses: 2,
      poolSize: 5,
      portBase: 32_000,
      portRangeWidth: 200,
      proxyPortBase: 10_000,
      sessionTimeoutMs: 900_000,
      workspaceBaseRoot: '/sandbox-workspaces',
    });
  });

  it('rejects min ready values larger than pool size', () => {
    expect(() => parseSandboxRuntimePoolDefaults({
      SRT_DEFAULT_MIN_READY_PROCESSES: '2',
      SRT_DEFAULT_POOL_SIZE: '1',
    })).toThrow('SRT_DEFAULT_MIN_READY_PROCESSES must be <= SRT_DEFAULT_POOL_SIZE.');
  });

  it('rejects proxy port ranges that cannot cover pool proxy pairs', () => {
    expect(() => parseSandboxRuntimePoolDefaults({
      SRT_DEFAULT_POOL_SIZE: '3',
      SRT_DEFAULT_PORT_RANGE_WIDTH: '5',
    })).toThrow('SRT_DEFAULT_PORT_RANGE_WIDTH must be at least SRT_DEFAULT_POOL_SIZE * 2.');
  });

  it('rejects non-positive integer env values', () => {
    expect(() => parseSandboxRuntimePoolDefaults({
      SRT_DEFAULT_POOL_SIZE: '0',
    })).toThrow('SRT_DEFAULT_POOL_SIZE must be a positive integer.');
  });

  it('drops fatal linux deny paths from env overrides', () => {
    expect(parseSandboxRuntimePoolDefaults({
      SRT_DEFAULT_DENY_READ: '/etc/passwd,/etc/mtab,/proc/mounts',
    }).defaultDenyRead).toEqual([
      '/etc/passwd',
      '/proc/mounts',
    ]);
  });
});

describe('normalizeSandboxRuntimeDenyReadPaths', () => {
  it('removes /etc/mtab and deduplicates while preserving order', () => {
    expect(normalizeSandboxRuntimeDenyReadPaths([
      '/etc/passwd',
      '/etc/mtab',
      '/proc/mounts',
      '/etc/passwd',
      ' /proc/self/mountinfo ',
    ])).toEqual([
      '/etc/passwd',
      '/proc/mounts',
      '/proc/self/mountinfo',
    ]);
  });
});
