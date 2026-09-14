import {
  MAX_CONSECUTIVE_RESTARTS,
  RESTART_BACKOFF_DELAYS_MS,
} from '@weiling-ai/shared';

export interface RestartPlanRestart {
  kind: 'restart';
  restartBackoffUntil: Date;
  restartCount: number;
}

export interface RestartPlanFailed {
  kind: 'failed';
  restartBackoffUntil: null;
  restartCount: number;
}

export type RestartPlan = RestartPlanRestart | RestartPlanFailed;

export interface RestartPlanOptions {
  keepRetryingAfterThreshold?: boolean;
}

export function calculateRestartPlan(
  currentRestartCount: number,
  observedAt: Date,
  options: RestartPlanOptions = {},
): RestartPlan {
  const nextRestartCount = currentRestartCount + 1;

  if (nextRestartCount >= MAX_CONSECUTIVE_RESTARTS) {
    if (options.keepRetryingAfterThreshold) {
      return {
        kind: 'restart',
        restartBackoffUntil: new Date(
          observedAt.getTime() + RESTART_BACKOFF_DELAYS_MS[RESTART_BACKOFF_DELAYS_MS.length - 1],
        ),
        restartCount: MAX_CONSECUTIVE_RESTARTS - 1,
      };
    }

    return {
      kind: 'failed',
      restartBackoffUntil: null,
      restartCount: nextRestartCount,
    };
  }

  const delayMs = RESTART_BACKOFF_DELAYS_MS[Math.min(currentRestartCount, RESTART_BACKOFF_DELAYS_MS.length - 1)];

  return {
    kind: 'restart',
    restartBackoffUntil: new Date(observedAt.getTime() + delayMs),
    restartCount: nextRestartCount,
  };
}
