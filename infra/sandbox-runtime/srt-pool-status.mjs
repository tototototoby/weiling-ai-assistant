import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const SRT_POOL_STATUS_FILE_VERSION = 2;

export async function writeStatusFile(statusFilePath, status) {
  await mkdir(dirname(statusFilePath), { recursive: true });
  const tempFile = `${statusFilePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
  await rename(tempFile, statusFilePath);
}

export function createStatusDocument({ children, lastErrorMessage, managerResourceUsage = null, now, pools }) {
  const poolStatuses = pools.map((pool) => {
    const child = children.get(pool.botInstanceId);
    const processAlive = child && child.child.exitCode == null && child.child.signalCode == null;
    const state = resolvePoolState(pool, child);

    return {
      activeSessions: child?.poolStats?.activeSessions ?? null,
      botInstanceId: pool.botInstanceId,
      busyProcesses: child?.poolStats?.busyProcesses ?? null,
      capacityDeficitSince: child?.capacityDeficitSince ?? null,
      cpuPercent: processAlive ? child?.resourceUsage?.cpuPercent ?? null : null,
      errorProcesses: child?.poolStats?.errorProcesses ?? null,
      lastErrorMessage: child?.lastErrorMessage ?? null,
      lastExitCode: child?.lastExitCode ?? null,
      lastHealthAt: child?.lastHealthAt ?? null,
      lastRestartAt: child?.lastRestartAt ?? null,
      pid: processAlive ? child.child.pid ?? null : null,
      poolSize: pool.poolSize,
      portRangeEnd: pool.portRangeEnd,
      portRangeStart: pool.portRangeStart,
      readyProcesses: child?.poolStats?.readyProcesses ?? null,
      restartNotBefore: child?.restartNotBefore ?? null,
      rssBytes: processAlive ? child?.resourceUsage?.rssBytes ?? null : null,
      startedAt: processAlive ? child.startedAt : null,
      state,
      terminalProcessCount: child?.poolStats?.terminalProcessCount ?? null,
      totalProcesses: child?.poolStats?.totalProcesses ?? null,
      url: pool.url,
    };
  });
  const runningPoolCount = poolStatuses.filter((pool) => pool.state === 'running').length;
  const degradedPoolCount = poolStatuses.filter((pool) => (
    pool.state === 'degraded'
    || pool.state === 'starting'
    || pool.state === 'stopping'
  )).length;
  const failedPoolCount = poolStatuses.filter((pool) => pool.state === 'failed').length;
  const knownActiveSessions = poolStatuses.filter((pool) => pool.activeSessions !== null);
  const totalActiveSessions = knownActiveSessions.length > 0
    ? knownActiveSessions.reduce((sum, pool) => sum + pool.activeSessions, 0)
    : null;

  return {
    manager: {
      cpuPercent: managerResourceUsage?.cpuPercent ?? null,
      degradedPoolCount,
      failedPoolCount,
      lastErrorMessage,
      lastReconcileAt: now,
      managedPoolCount: pools.length,
      pid: process.pid,
      rssBytes: managerResourceUsage?.rssBytes ?? process.memoryUsage().rss,
      runningPoolCount,
      state: failedPoolCount > 0 || degradedPoolCount > 0 || lastErrorMessage ? 'degraded' : 'running',
      totalActiveSessions,
      totalPoolSize: pools.reduce((sum, pool) => sum + pool.poolSize, 0),
      uptimeMs: Math.round(process.uptime() * 1000),
    },
    pools: poolStatuses,
    updatedAt: now,
    version: SRT_POOL_STATUS_FILE_VERSION,
  };
}

function resolvePoolState(pool, child) {
  if (!pool.enabled || !child) {
    return 'stopped';
  }

  if (child.child.exitCode != null || child.child.signalCode != null) {
    return child.state === 'failed' ? 'failed' : 'stopped';
  }

  return child.state ?? 'running';
}
