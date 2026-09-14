export interface SingleFlightTask {
  run(): Promise<void>;
  waitForIdle(): Promise<void>;
}

export interface SingleFlightTaskOptions {
  onStall?: (error: Error) => void;
  stallTimeoutMs?: number;
}

export function createSingleFlightTask(
  task: () => Promise<void>,
  onError: (error: unknown) => void = console.error,
  options: SingleFlightTaskOptions = {},
): SingleFlightTask {
  let inFlight: Promise<void> | null = null;

  const run = () => {
    if (inFlight) return inFlight;

    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const next = Promise.resolve()
      .then(task)
      .catch((error: unknown) => {
        try {
          onError(error);
        } catch (reportingError) {
          console.error('Failed to report a supervisor reconcile error.');
          console.error(reportingError);
        }
      })
      .finally(() => {
        if (stallTimer) {
          clearTimeout(stallTimer);
          stallTimer = null;
        }

        if (inFlight === next) {
          inFlight = null;
        }
      });

    inFlight = next;

    if (options.stallTimeoutMs && options.onStall) {
      stallTimer = setTimeout(() => {
        if (inFlight !== next) {
          return;
        }

        try {
          options.onStall?.(
            new Error(
              `Supervisor reconcile task did not settle within ${options.stallTimeoutMs}ms.`,
            ),
          );
        } catch (reportingError) {
          console.error('Failed to report a stalled supervisor reconcile task.');
          console.error(reportingError);
        }
      }, options.stallTimeoutMs);
      stallTimer.unref?.();
    }

    return next;
  };

  return {
    run,
    waitForIdle: async () => {
      await inFlight;
    },
  };
}
