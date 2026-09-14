import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY,
  type MealReminderPreferenceRepository,
} from '@weiling-ai/db';
import {
  getConsentPromptRetryDelayMs,
  isWorkday,
  MealReminderScheduler,
  parseRainForecast,
} from '../meal-reminder-scheduler';

const calendar = {
  adjustedWorkdays: ['2026-02-14'],
  holidays: ['2026-02-16'],
  timezone: 'Asia/Shanghai',
  year: 2026,
};

describe('MealReminderScheduler', () => {
  it('prompts each unasked employee once outside the reminder window', async () => {
    const fixture = createFixture({ unasked: true });
    const now = new Date('2026-07-23T01:00:00.000Z');

    await fixture.scheduler.runOnce(now);

    expect(fixture.processManager.sendAdminMessage).toHaveBeenCalledWith(
      'bot_unasked',
      'meal-consent:v1:bot_unasked',
      '我是微Link。工作日需要我提醒你点外卖吗？需要的话请回复“开启外卖提醒”，不需要请回复“关闭外卖提醒”。',
      'meal-consent:v1:bot_unasked',
    );
    expect(fixture.reminderQueue.sendAdminMessage).not.toHaveBeenCalled();
    expect(fixture.preferences.setStatus).toHaveBeenCalledWith(
      'bot_unasked',
      'prompted',
      now,
    );
  });

  it('backs off a failed consent prompt instead of retrying every minute', async () => {
    const fixture = createFixture({ consentError: new Error('offline'), unasked: true });
    const firstAttempt = new Date('2026-07-23T01:00:00.000Z');

    await fixture.scheduler.runOnce(firstAttempt);
    await fixture.scheduler.runOnce(new Date(firstAttempt.getTime() + 60_000));

    expect(fixture.processManager.sendAdminMessage).toHaveBeenCalledTimes(1);
    expect(fixture.preferences.setStatus).not.toHaveBeenCalled();

    await fixture.scheduler.runOnce(new Date(firstAttempt.getTime() + 5 * 60_000));
    expect(fixture.processManager.sendAdminMessage).toHaveBeenCalledTimes(2);

    await fixture.scheduler.runOnce(new Date(firstAttempt.getTime() + 10 * 60_000));
    expect(fixture.processManager.sendAdminMessage).toHaveBeenCalledTimes(2);
  });

  it('retries an unasked preference immediately when that Bot becomes active', async () => {
    const fixture = createFixture({ consentError: new Error('offline'), unasked: true });
    const firstAttempt = new Date('2026-07-23T01:00:00.000Z');

    await fixture.scheduler.runOnce(firstAttempt);
    await fixture.scheduler.handleUserActive(
      'bot_unasked',
      new Date(firstAttempt.getTime() + 60_000),
    );

    expect(fixture.processManager.sendAdminMessage).toHaveBeenCalledTimes(2);
  });

  it('does not wake another Bot consent prompt', async () => {
    const fixture = createFixture({ unasked: true });

    await fixture.scheduler.handleUserActive(
      'bot_other',
      new Date('2026-07-23T01:00:00.000Z'),
    );

    expect(fixture.processManager.sendAdminMessage).not.toHaveBeenCalled();
    expect(fixture.preferences.setStatus).not.toHaveBeenCalled();
  });

  it('does not send a consent prompt outside daytime work hours', async () => {
    const fixture = createFixture({ unasked: true });

    await fixture.scheduler.runOnce(new Date('2026-07-23T00:59:00.000Z'));
    await fixture.scheduler.runOnce(new Date('2026-07-23T10:00:00.000Z'));

    expect(fixture.processManager.sendAdminMessage).not.toHaveBeenCalled();
    expect(fixture.preferences.setStatus).not.toHaveBeenCalled();
  });

  it('sends the rain warning at 10:30 on an adjusted Saturday workday', async () => {
    const fixture = createFixture({ probability: 80 });

    await fixture.scheduler.runOnce(new Date('2026-02-14T02:30:00.000Z'));

    expect(fixture.reminderQueue.sendAdminMessage).toHaveBeenCalledWith(
      'bot_1',
      'meal:bot_1:2026-02-14',
      '我是微Link。今天可能下雨，外卖配送可能会比平时慢，记得现在点外卖。',
      'meal:bot_1:2026-02-14',
    );
    expect(fixture.preferences.markReminded).toHaveBeenCalledWith(
      'bot_1',
      '2026-02-14',
      expect.any(Date),
    );
    expect(fixture.processManager.sendAdminMessage).not.toHaveBeenCalled();
  });

  it('uses the latest configured copy for a scheduled reminder', async () => {
    const fixture = createFixture({ probability: 0 });
    fixture.messageCopy.getCopy.mockResolvedValue({
      ...DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY,
      assistantName: '测试助手',
      mealStandardReminder: '测试助手提醒 {{date}}',
    });

    await fixture.scheduler.runOnce(new Date('2026-02-14T02:45:00.000Z'));

    expect(fixture.reminderQueue.sendAdminMessage).toHaveBeenCalledWith(
      'bot_1',
      'meal:bot_1:2026-02-14',
      '测试助手提醒 2026-02-14',
      'meal:bot_1:2026-02-14',
    );
  });

  it('does not mark a daily reminder when durable enqueue fails', async () => {
    const fixture = createFixture({
      probability: 80,
      reminderError: new Error('database unavailable'),
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await fixture.scheduler.runOnce(new Date('2026-02-14T02:30:00.000Z'));
    } finally {
      consoleError.mockRestore();
    }

    expect(fixture.reminderQueue.sendAdminMessage).toHaveBeenCalledOnce();
    expect(fixture.preferences.markReminded).not.toHaveBeenCalled();
  });

  it('waits until 10:45 on a dry workday and then sends the standard reminder', async () => {
    const fixture = createFixture({ probability: 10 });

    await fixture.scheduler.runOnce(new Date('2026-07-23T02:30:00.000Z'));
    expect(fixture.reminderQueue.sendAdminMessage).not.toHaveBeenCalled();

    await fixture.scheduler.runOnce(new Date('2026-07-23T02:45:00.000Z'));
    expect(fixture.reminderQueue.sendAdminMessage).toHaveBeenCalledWith(
      'bot_1',
      'meal:bot_1:2026-07-23',
      '我是微Link。该点外卖了，记得安排今天的午餐。',
      'meal:bot_1:2026-07-23',
    );
  });

  it('falls back to 10:45 when the weather service is unavailable', async () => {
    const fixture = createFixture({ fetchError: new Error('offline') });

    await fixture.scheduler.runOnce(new Date('2026-07-23T02:30:00.000Z'));
    expect(fixture.reminderQueue.sendAdminMessage).not.toHaveBeenCalled();

    await fixture.scheduler.runOnce(new Date('2026-07-23T02:45:00.000Z'));
    expect(fixture.reminderQueue.sendAdminMessage).toHaveBeenCalledWith(
      'bot_1',
      'meal:bot_1:2026-07-23',
      '我是微Link。该点外卖了，记得安排今天的午餐。',
      'meal:bot_1:2026-07-23',
    );
  });

  it('does not send on a statutory holiday or after the date was already recorded', async () => {
    const holiday = createFixture({ probability: 80 });
    await holiday.scheduler.runOnce(new Date('2026-02-16T02:30:00.000Z'));
    expect(holiday.reminderQueue.sendAdminMessage).not.toHaveBeenCalled();

    const duplicate = createFixture({ lastReminderDate: '2026-07-23', probability: 80 });
    await duplicate.scheduler.runOnce(new Date('2026-07-23T02:30:00.000Z'));
    expect(duplicate.reminderQueue.sendAdminMessage).not.toHaveBeenCalled();
  });
});

describe('meal reminder calendar and forecast parsing', () => {
  it('uses bounded consent-prompt retry delays', () => {
    expect(getConsentPromptRetryDelayMs(1)).toBe(5 * 60_000);
    expect(getConsentPromptRetryDelayMs(2)).toBe(30 * 60_000);
    expect(getConsentPromptRetryDelayMs(5)).toBe(24 * 60 * 60_000);
    expect(getConsentPromptRetryDelayMs(99)).toBe(24 * 60 * 60_000);
  });

  it('fails closed outside the covered calendar year and honors holidays and adjusted workdays', () => {
    expect(isWorkday('2026-02-14', calendar)).toBe(true);
    expect(isWorkday('2026-02-16', calendar)).toBe(false);
    expect(isWorkday('2027-07-23', calendar)).toBe(false);
  });

  it('recognizes rain amount, probability, and WMO rain codes', () => {
    expect(parseRainForecast(weatherPayload({ rain: 0.1 }), '2026-07-23')).toBe('rain');
    expect(parseRainForecast(weatherPayload({ probability: 50 }), '2026-07-23')).toBe('rain');
    expect(parseRainForecast(weatherPayload({ code: 80 }), '2026-07-23')).toBe('rain');
    expect(parseRainForecast(weatherPayload({ probability: 10 }), '2026-07-23')).toBe('dry');
  });
});

function createFixture(input: {
  consentError?: Error;
  fetchError?: Error;
  lastReminderDate?: string | null;
  probability?: number;
  reminderError?: Error;
  unasked?: boolean;
}) {
  const preferences = {
    ensureForAllBots: vi.fn().mockResolvedValue([]),
    listEnabled: vi.fn().mockResolvedValue([{
      botInstanceId: 'bot_1',
      lastReminderDate: input.lastReminderDate ?? null,
    }]),
    listUnasked: vi.fn().mockResolvedValue(input.unasked ? [{ botInstanceId: 'bot_unasked' }] : []),
    markReminded: vi.fn().mockResolvedValue(undefined),
    setStatus: vi.fn().mockResolvedValue(undefined),
  } as unknown as MealReminderPreferenceRepository;
  const processManager = {
    sendAdminMessage: input.consentError
      ? vi.fn().mockRejectedValue(input.consentError)
      : vi.fn().mockResolvedValue(undefined),
  };
  const reminderQueue = {
    sendAdminMessage: input.reminderError
      ? vi.fn().mockRejectedValue(input.reminderError)
      : vi.fn().mockResolvedValue(undefined),
  };
  const messageCopy = {
    getCopy: vi.fn().mockResolvedValue(DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY),
  };
  const fetchImpl = input.fetchError
    ? vi.fn().mockRejectedValue(input.fetchError)
    : vi.fn().mockResolvedValue(new Response(JSON.stringify(weatherPayload({
      probability: input.probability ?? 0,
    }))));

  return {
    messageCopy,
    reminderQueue,
    preferences,
    processManager,
    scheduler: new MealReminderScheduler({
      calendar,
      fetchImpl,
      messageCopy,
      preferences,
      processManager,
      reminderQueue,
      workspaceRoot: '/unused',
    }),
  };
}

function weatherPayload(input: { code?: number; probability?: number; rain?: number }) {
  return {
    hourly: {
      precipitation_probability: [input.probability ?? 0, input.probability ?? 0],
      rain: [input.rain ?? 0, input.rain ?? 0],
      time: ['2026-02-14T11:00', '2026-07-23T11:00'],
      weather_code: [input.code ?? 0, input.code ?? 0],
    },
  };
}
