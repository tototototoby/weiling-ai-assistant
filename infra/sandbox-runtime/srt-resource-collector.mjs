import { readFile } from 'node:fs/promises';

const DEFAULT_CLOCK_TICKS_PER_SECOND = 100;
const KIB_BYTES = 1024;

export async function readProcessResourceUsage(pid, previousSample = null) {
  try {
    const [rawStat, rawStatus] = await Promise.all([
      readFile(`/proc/${pid}/stat`, 'utf8'),
      readFile(`/proc/${pid}/status`, 'utf8'),
    ]);
    const stat = parseProcStat(rawStat);
    const status = parseProcStatus(rawStatus);
    const elapsedMs = previousSample
      ? Date.now() - previousSample.sampledAtMs
      : 0;

    return {
      cpuPercent: previousSample
        ? calculateCpuPercent({
          clockTicksPerSecond: DEFAULT_CLOCK_TICKS_PER_SECOND,
          current: stat,
          elapsedMs,
          previous: previousSample.stat,
        })
        : null,
      rssBytes: status.rssBytes,
      sampledAtMs: Date.now(),
      stat,
    };
  } catch {
    return {
      cpuPercent: null,
      rssBytes: null,
      sampledAtMs: Date.now(),
      stat: null,
    };
  }
}

export function parseProcStat(raw) {
  const closeParenIndex = raw.lastIndexOf(')');
  const pid = Number(raw.slice(0, raw.indexOf(' ')));
  const fields = raw.slice(closeParenIndex + 2).trim().split(/\s+/);
  const utime = Number(fields[11] ?? 0);
  const stime = Number(fields[12] ?? 0);
  const cutime = Number(fields[13] ?? 0);
  const cstime = Number(fields[14] ?? 0);

  return {
    pid,
    startTimeTicks: Number(fields[19] ?? 0),
    // Keep manager CPU scoped to the manager process. Child CPU is exposed
    // separately by procfs and must not be counted in this process metric.
    totalCpuTicks: utime + stime,
    childCpuTicks: cutime + cstime,
  };
}

export function parseProcStatus(raw) {
  const rssLine = raw.split('\n').find((line) => line.startsWith('VmRSS:'));
  const rssKiB = rssLine ? Number(rssLine.match(/\d+/)?.[0] ?? 0) : null;

  return {
    rssBytes: rssKiB === null ? null : rssKiB * KIB_BYTES,
  };
}

export function calculateCpuPercent({ clockTicksPerSecond, current, elapsedMs, previous }) {
  if (!previous || !current || elapsedMs <= 0) {
    return null;
  }

  const tickDelta = current.totalCpuTicks - previous.totalCpuTicks;
  if (tickDelta < 0) {
    return null;
  }

  const elapsedSeconds = elapsedMs / 1000;
  const cpuSeconds = tickDelta / clockTicksPerSecond;
  return Math.round((cpuSeconds / elapsedSeconds) * 1000) / 10;
}
