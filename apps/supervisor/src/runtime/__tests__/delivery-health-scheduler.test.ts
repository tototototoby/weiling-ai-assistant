import { describe, expect, it, vi } from 'vitest';
import type {
  DeliveryHealthCheckRepository,
  GlobalDeliveryHealthConfigRepository,
} from '@weiling-ai/db';
import {
  DeliveryHealthScheduler,
  type DeliveryHealthSchedulerDependencies,
} from '../delivery-health-scheduler';

const NOW = new Date('2026-08-24T04:00:00.000Z');
const CHECK_DATE = '2026-08-23';
const TODAY_DATE = '2026-08-24';

describe('DeliveryHealthScheduler', () => {
  it('returns null while delivery health is disabled', async () => {
    const fixture = createFixture({
      enabled: false,
      failed: 4,
      stuck: 1,
    });

    await expect(fixture.scheduler.runOnce(NOW)).resolves.toBeNull();

    expect(fixture.checks.findByDate).not.toHaveBeenCalled();
    expect(fixture.deliveries.summarizeByStatus).not.toHaveBeenCalled();
    expect(fixture.sendAlertEmail).not.toHaveBeenCalled();
  });

  it('returns the persisted record when the check date already exists', async () => {
    const fixture = createFixture({
      existing: {
        alertSent: false,
        summaryJson: '{"cached":true}',
      },
    });

    const result = await fixture.scheduler.runOnce(NOW);

    expect(result).toEqual({
      alert: false,
      checkDate: CHECK_DATE,
      summaryJson: '{"cached":true}',
    });
    expect(fixture.deliveries.summarizeByStatus).not.toHaveBeenCalled();
    expect(fixture.checks.upsertByDate).not.toHaveBeenCalled();
  });

  it('alerts and persists when failed deliveries exceed the threshold', async () => {
    const fixture = createFixture({
      failed: 4,
      stuck: 0,
    });

    const result = await fixture.scheduler.runOnce(NOW);

    expect(result).toEqual({
      alert: true,
      checkDate: CHECK_DATE,
      summaryJson: expect.stringContaining('"failedCount":4'),
    });
    expect(fixture.deliveries.summarizeByStatus).toHaveBeenCalledWith(
      new Date(`${CHECK_DATE}T00:00:00+08:00`),
      new Date(`${TODAY_DATE}T00:00:00+08:00`),
    );
    expect(fixture.deliveries.listStuckDelivering).toHaveBeenCalledWith(
      new Date(NOW.getTime() - 24 * 3600_000),
    );
    expect(fixture.sendAlertEmail).toHaveBeenCalledWith(
      'ops@example.com',
      '微Link · 微灵 AI 助手投递健康告警',
      expect.stringContaining(CHECK_DATE),
    );
    const alertText = fixture.sendAlertEmail.mock.calls[0][2];
    expect(alertText).toContain('4');
    expect(alertText).toContain('3');
    expect(alertText).toContain('0');
    expect(fixture.checks.upsertByDate).toHaveBeenCalledWith({
      alertSent: true,
      checkDate: CHECK_DATE,
      id: `dhc:${CHECK_DATE}`,
      summaryJson: expect.stringContaining('"alert":true'),
    });
  });

  it('does not alert when failed deliveries stay at or below the threshold', async () => {
    const fixture = createFixture({
      failed: 3,
      stuck: 0,
    });

    const result = await fixture.scheduler.runOnce(NOW);

    expect(result).toEqual({
      alert: false,
      checkDate: CHECK_DATE,
      summaryJson: expect.stringContaining('"alert":false'),
    });
    expect(fixture.sendAlertEmail).not.toHaveBeenCalled();
    expect(fixture.checks.upsertByDate).toHaveBeenCalledWith(
      expect.objectContaining({
        alertSent: false,
        checkDate: CHECK_DATE,
        id: `dhc:${CHECK_DATE}`,
      }),
    );
  });

  it('alerts when any delivery is stuck', async () => {
    const fixture = createFixture({
      failed: 0,
      stuck: 2,
    });

    const result = await fixture.scheduler.runOnce(NOW);

    expect(result).toEqual({
      alert: true,
      checkDate: CHECK_DATE,
      summaryJson: expect.stringContaining('"stuckCount":2'),
    });
    expect(fixture.sendAlertEmail).toHaveBeenCalledTimes(1);
    expect(fixture.checks.upsertByDate).toHaveBeenCalledWith(
      expect.objectContaining({ alertSent: true }),
    );
  });

  it('persists the alert even when sending the alert email fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fixture = createFixture({
      emailError: new Error('smtp unavailable'),
      failed: 5,
      stuck: 0,
    });

    try {
      const result = await fixture.scheduler.runOnce(NOW);

      expect(result?.alert).toBe(true);
      expect(fixture.checks.upsertByDate).toHaveBeenCalledWith(
        expect.objectContaining({ alertSent: true }),
      );
      expect(consoleError).toHaveBeenCalledWith('Delivery health alert email failed.');
    } finally {
      consoleError.mockRestore();
    }
  });
});

function createFixture(input: {
  emailError?: Error;
  enabled?: boolean;
  existing?: {
    alertSent: boolean;
    summaryJson: string;
  };
  failed?: number;
  stuck?: number;
} = {}) {
  const config = {
    alertEmail: 'ops@example.com',
    checkTime: '09:00',
    createdAt: NOW,
    enabled: input.enabled ?? true,
    failedThreshold: 3,
    id: 'global',
    observedRevision: null,
    revision: 1,
    stuckHours: 24,
    updatedAt: NOW,
    updatedByUserId: null,
  } as Awaited<ReturnType<GlobalDeliveryHealthConfigRepository['ensure']>>;
  const configRepository = {
    ensure: vi.fn().mockResolvedValue(config),
  } as unknown as DeliveryHealthSchedulerDependencies['configRepository'];
  const deliveries = {
    listStuckDelivering: vi.fn().mockResolvedValue(
      Array.from({ length: input.stuck ?? 0 }, (_, index) => ({ id: `stuck_${index}` })),
    ),
    summarizeByStatus: vi.fn().mockResolvedValue({
      failed: input.failed ?? 0,
    }),
  } as unknown as DeliveryHealthSchedulerDependencies['deliveries'];
  const checks = {
    findByDate: vi.fn().mockResolvedValue(
      input.existing
        ? {
            alertSent: input.existing.alertSent,
            checkDate: CHECK_DATE,
            createdAt: NOW,
            id: `dhc:${CHECK_DATE}`,
            summaryJson: input.existing.summaryJson,
          }
        : null,
    ),
    upsertByDate: vi.fn().mockImplementation((value) => Promise.resolve(value)),
  } as unknown as DeliveryHealthSchedulerDependencies['checks'];
  const sendAlertEmail = input.emailError
    ? vi.fn().mockRejectedValue(input.emailError)
    : vi.fn().mockResolvedValue(undefined);
  const emailSender = {
    sendAlertEmail,
  } as unknown as DeliveryHealthSchedulerDependencies['emailSender'];

  return {
    checks,
    deliveries,
    sendAlertEmail,
    scheduler: new DeliveryHealthScheduler({
      checks,
      configRepository,
      deliveries,
      emailSender,
    }),
  };
}
