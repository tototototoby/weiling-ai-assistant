import { describe, expect, it } from 'vitest';
// @ts-expect-error repo-local ESM resource collector has no TS declaration surface
import { calculateCpuPercent, parseProcStat, parseProcStatus } from '../../../../../infra/sandbox-runtime/srt-resource-collector.mjs';
// @ts-expect-error repo-local ESM status projector has no TS declaration surface
import { createStatusDocument } from '../../../../../infra/sandbox-runtime/srt-pool-status.mjs';

describe('sandbox-runtime resource collector', () => {
  it('parses process rss from proc status', () => {
    expect(parseProcStatus('Name:\tnode\nVmRSS:\t  12345 kB\n')).toMatchObject({
      rssBytes: 12_641_280,
    });
  });

  it('parses proc stat with process names containing spaces', () => {
    expect(parseProcStat('42 (node worker) S 1 1 1 0 -1 4194560 1 0 0 0 100 20 7 3 20 0 1 0 1000 0')).toMatchObject({
      pid: 42,
      startTimeTicks: 1000,
      totalCpuTicks: 120,
      childCpuTicks: 10,
    });
  });

  it('calculates cpu percent from process tick deltas', () => {
    const previous = parseProcStat('42 (node) S 1 1 1 0 -1 4194560 1 0 0 0 100 20 50 20 20 0 1 0 1000 0');
    const current = parseProcStat('42 (node) S 1 1 1 0 -1 4194560 1 0 0 0 130 30 50 20 20 0 1 0 2000 0');

    expect(calculateCpuPercent({
      clockTicksPerSecond: 100,
      current,
      elapsedMs: 1_000,
      previous,
    })).toBe(40);
  });

  it('publishes the manager process resource sample', () => {
    const document = createStatusDocument({
      children: new Map(),
      lastErrorMessage: null,
      managerResourceUsage: {
        cpuPercent: 2.5,
        rssBytes: 64 * 1024 * 1024,
      },
      now: '2026-07-23T02:00:00.000Z',
      pools: [],
    });

    expect(document.manager).toMatchObject({
      cpuPercent: 2.5,
      rssBytes: 64 * 1024 * 1024,
    });
  });
});
