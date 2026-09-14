import { describe, expect, it } from 'vitest';
import { calculateRestartPlan } from '../restart-policy';

describe('calculateRestartPlan', () => {
  it('returns the documented restart backoff sequence before failing the instance', () => {
    const now = new Date('2026-03-30T00:00:00.000Z');

    expect(calculateRestartPlan(0, now)).toEqual({
      kind: 'restart',
      restartBackoffUntil: new Date('2026-03-30T00:00:05.000Z'),
      restartCount: 1,
    });
    expect(calculateRestartPlan(1, now)).toEqual({
      kind: 'restart',
      restartBackoffUntil: new Date('2026-03-30T00:00:15.000Z'),
      restartCount: 2,
    });
    expect(calculateRestartPlan(2, now)).toEqual({
      kind: 'restart',
      restartBackoffUntil: new Date('2026-03-30T00:00:30.000Z'),
      restartCount: 3,
    });
    expect(calculateRestartPlan(3, now)).toEqual({
      kind: 'failed',
      restartBackoffUntil: null,
      restartCount: 4,
    });
  });

  it('keeps transient network failures recoverable with a capped retry rate', () => {
    const now = new Date('2026-03-30T00:00:00.000Z');

    expect(calculateRestartPlan(3, now, {
      keepRetryingAfterThreshold: true,
    })).toEqual({
      kind: 'restart',
      restartBackoffUntil: new Date('2026-03-30T00:01:00.000Z'),
      restartCount: 3,
    });
  });
});
