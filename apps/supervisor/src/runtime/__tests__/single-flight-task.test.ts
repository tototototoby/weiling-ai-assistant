import { describe, expect, it, vi } from 'vitest';
import { createSingleFlightTask } from '../single-flight-task';

describe('createSingleFlightTask', () => {
  it('does not overlap work and runs again after the active task settles', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const task = vi.fn(async () => {
      await gate;
    });
    const runner = createSingleFlightTask(task);

    const first = runner.run();
    const second = runner.run();

    expect(second).toBe(first);
    await Promise.resolve();
    expect(task).toHaveBeenCalledOnce();

    release();
    await runner.waitForIdle();
    await runner.run();

    expect(task).toHaveBeenCalledTimes(2);
  });

  it('consumes task failures and allows a later run', async () => {
    const failure = new Error('reconcile failed');
    const onError = vi.fn<(error: unknown) => void>();
    const task = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined);
    const runner = createSingleFlightTask(task, onError);

    await expect(runner.run()).resolves.toBeUndefined();
    await expect(runner.run()).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledWith(failure);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('reports a stalled task once without allowing overlapping work', async () => {
    vi.useFakeTimers();

    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const task = vi.fn(async () => {
        await gate;
      });
      const onStall = vi.fn<(error: Error) => void>();
      const runner = createSingleFlightTask(task, undefined, {
        onStall,
        stallTimeoutMs: 1_000,
      });

      const first = runner.run();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(onStall).toHaveBeenCalledTimes(1);
      expect(onStall).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Supervisor reconcile task did not settle within 1000ms.',
        }),
      );
      expect(runner.run()).toBe(first);
      expect(task).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(10_000);
      expect(onStall).toHaveBeenCalledTimes(1);

      release();
      await runner.waitForIdle();
    } finally {
      vi.useRealTimers();
    }
  });
});
