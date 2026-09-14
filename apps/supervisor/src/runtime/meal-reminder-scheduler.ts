import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MealReminderPreferenceRepository } from '@weiling-ai/db';
import type { AdminMessageSender } from './admin-message-dispatcher';
import {
  type AdminMessageCopyProvider,
  renderAdminMessageCopy,
} from './admin-message-copy';

const TIMEZONE = 'Asia/Shanghai';
const WEATHER_RETRY_INTERVAL_MS = 60_000;
const CONSENT_PROMPT_RETRY_DELAYS_MS = [
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
] as const;

export interface WorkdayCalendar {
  adjustedWorkdays: string[];
  holidays: string[];
  timezone: string;
  year: number;
}

type RainForecast = 'dry' | 'rain' | 'unknown';

interface WeatherCache {
  checkedAt: number;
  date: string;
  result: RainForecast;
}

interface ConsentPromptRetryState {
  attemptCount: number;
  retryAfter: number;
}

export interface MealReminderSchedulerDependencies {
  calendar?: WorkdayCalendar;
  fetchImpl?: typeof fetch;
  messageCopy: AdminMessageCopyProvider;
  preferences: MealReminderPreferenceRepository;
  processManager: AdminMessageSender;
  reminderQueue: AdminMessageSender;
  workspaceRoot: string;
}

export class MealReminderScheduler {
  private activePass: Promise<void> | null = null;
  private calendar: WorkdayCalendar | null;
  private readonly fetchImpl: typeof fetch;
  private readonly messageCopy: AdminMessageCopyProvider;
  private readonly preferences: MealReminderPreferenceRepository;
  private readonly processManager: AdminMessageSender;
  private readonly promptRetryState = new Map<string, ConsentPromptRetryState>();
  private readonly reminderQueue: AdminMessageSender;
  private weatherCache: WeatherCache | null = null;
  private readonly workspaceRoot: string;

  constructor(dependencies: MealReminderSchedulerDependencies) {
    this.calendar = dependencies.calendar ?? null;
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.messageCopy = dependencies.messageCopy;
    this.preferences = dependencies.preferences;
    this.processManager = dependencies.processManager;
    this.reminderQueue = dependencies.reminderQueue;
    this.workspaceRoot = dependencies.workspaceRoot;
  }

  async runOnce(now: Date = new Date()): Promise<void> {
    if (this.activePass) return this.activePass;
    const pass = this.runPass(now).finally(() => {
      if (this.activePass === pass) this.activePass = null;
    });
    this.activePass = pass;
    return pass;
  }

  async handleUserActive(botInstanceId: string, now: Date = new Date()): Promise<void> {
    if (this.activePass) await this.activePass;
    this.promptRetryState.delete(botInstanceId);
    const copy = await this.messageCopy.getCopy();
    await this.promptUnaskedPreferences(now, copy, botInstanceId);
  }

  private async runPass(now: Date): Promise<void> {
    const copy = await this.messageCopy.getCopy();
    await this.preferences.ensureForAllBots(now);
    const local = getShanghaiDateTime(now);
    const minuteOfDay = (local.hour * 60) + local.minute;
    const calendar = await this.getCalendar();
    const workday = isWorkday(local.date, calendar);

    if (workday && minuteOfDay >= 9 * 60 && minuteOfDay < 18 * 60) {
      await this.promptUnaskedPreferences(now, copy);
    }

    if (minuteOfDay < 10 * 60 + 30 || minuteOfDay >= 13 * 60) return;
    if (!workday) return;

    const enabled = (await this.preferences.listEnabled())
      .filter((preference) => preference.lastReminderDate !== local.date);
    if (enabled.length === 0) return;

    const forecast = await this.getRainForecast(local.date, now);
    if (minuteOfDay < 10 * 60 + 45 && forecast !== 'rain') return;
    const template = forecast === 'rain'
      ? copy.mealRainReminder
      : copy.mealStandardReminder;
    const message = renderAdminMessageCopy(template, {
      assistantName: copy.assistantName,
      date: local.date,
    });

    await Promise.all(enabled.map(async (preference) => {
      try {
        await this.reminderQueue.sendAdminMessage(
          preference.botInstanceId,
          `meal:${preference.botInstanceId}:${local.date}`,
          message,
          `meal:${preference.botInstanceId}:${local.date}`,
        );
        await this.preferences.markReminded(preference.botInstanceId, local.date, new Date());
      } catch (error) {
        console.error(`Meal reminder delivery failed [${preference.botInstanceId}]`);
        console.error(error);
      }
    }));
  }

  private async promptUnaskedPreferences(
    now: Date,
    copy: Awaited<ReturnType<AdminMessageCopyProvider['getCopy']>>,
    botInstanceId?: string,
  ): Promise<void> {
    const unasked = (await this.preferences.listUnasked())
      .filter((preference) => !botInstanceId || preference.botInstanceId === botInstanceId);

    await Promise.all(unasked.map(async (preference) => {
      const retryState = this.promptRetryState.get(preference.botInstanceId);
      if (retryState && retryState.retryAfter > now.getTime()) return;

      const semanticKey = `meal-consent:v1:${preference.botInstanceId}`;
      try {
        await this.processManager.sendAdminMessage(
          preference.botInstanceId,
          semanticKey,
          renderAdminMessageCopy(copy.mealConsentPrompt, {
            assistantName: copy.assistantName,
            date: getShanghaiDateTime(now).date,
          }),
          semanticKey,
        );
        await this.preferences.setStatus(preference.botInstanceId, 'prompted', now);
        this.promptRetryState.delete(preference.botInstanceId);
      } catch (error) {
        const attemptCount = (retryState?.attemptCount ?? 0) + 1;
        this.promptRetryState.set(preference.botInstanceId, {
          attemptCount,
          retryAfter: now.getTime() + getConsentPromptRetryDelayMs(attemptCount),
        });
        console.error(`Meal reminder consent prompt failed [${preference.botInstanceId}]`);
        console.error(error);
      }
    }));
  }

  private async getCalendar(): Promise<WorkdayCalendar> {
    if (this.calendar) return this.calendar;
    const filePath = join(
      this.workspaceRoot,
      'resources',
      'skills',
      'managed',
      'morning-briefing',
      'assets',
      'china-workdays-2026.json',
    );
    this.calendar = parseCalendar(await readFile(filePath, 'utf8'));
    return this.calendar;
  }

  private async getRainForecast(date: string, now: Date): Promise<RainForecast> {
    if (
      this.weatherCache?.date === date
      && (
        this.weatherCache.result !== 'unknown'
        || now.getTime() - this.weatherCache.checkedAt < WEATHER_RETRY_INTERVAL_MS
      )
    ) {
      return this.weatherCache.result;
    }

    let result: RainForecast = 'unknown';
    try {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.searchParams.set('latitude', '24.4798');
      url.searchParams.set('longitude', '118.0894');
      url.searchParams.set('timezone', TIMEZONE);
      url.searchParams.set('forecast_days', '1');
      url.searchParams.set(
        'hourly',
        'rain,precipitation_probability,weather_code',
      );
      const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error(`Weather request failed with status ${response.status}.`);
      result = parseRainForecast(await response.json(), date);
    } catch (error) {
      console.error('Meal reminder weather lookup failed; deferring to the 10:45 fallback.');
      console.error(error);
    }

    this.weatherCache = { checkedAt: now.getTime(), date, result };
    return result;
  }
}

export function getConsentPromptRetryDelayMs(attemptCount: number): number {
  const index = Math.min(
    Math.max(0, Math.floor(attemptCount) - 1),
    CONSENT_PROMPT_RETRY_DELAYS_MS.length - 1,
  );
  return CONSENT_PROMPT_RETRY_DELAYS_MS[index];
}

export function isWorkday(date: string, calendar: WorkdayCalendar): boolean {
  const year = Number(date.slice(0, 4));
  if (calendar.year !== year || calendar.timezone !== TIMEZONE) return false;
  if (calendar.adjustedWorkdays.includes(date)) return true;
  if (calendar.holidays.includes(date)) return false;
  const day = new Date(`${date}T12:00:00+08:00`).getUTCDay();
  return day >= 1 && day <= 5;
}

export function parseRainForecast(value: unknown, date: string): RainForecast {
  if (typeof value !== 'object' || value === null) return 'unknown';
  const hourly = (value as { hourly?: unknown }).hourly;
  if (typeof hourly !== 'object' || hourly === null) return 'unknown';
  const data = hourly as Record<string, unknown>;
  const times = data.time;
  const rain = data.rain;
  const probabilities = data.precipitation_probability;
  const codes = data.weather_code;

  if (!Array.isArray(times) || !Array.isArray(rain)
    || !Array.isArray(probabilities) || !Array.isArray(codes)) {
    return 'unknown';
  }

  let observed = false;
  for (let index = 0; index < times.length; index += 1) {
    const time = times[index];
    if (typeof time !== 'string' || time < `${date}T10:00` || time > `${date}T13:00`) continue;
    observed = true;
    const weatherCode = Number(codes[index]);
    if (Number(rain[index]) > 0
      || Number(probabilities[index]) >= 50
      || isRainWeatherCode(weatherCode)) {
      return 'rain';
    }
  }

  return observed ? 'dry' : 'unknown';
}

function isRainWeatherCode(code: number): boolean {
  return (code >= 51 && code <= 67)
    || (code >= 80 && code <= 82)
    || (code >= 95 && code <= 99);
}

function parseCalendar(source: string): WorkdayCalendar {
  const value = JSON.parse(source) as Partial<WorkdayCalendar>;
  if (!Number.isInteger(value.year)
    || value.timezone !== TIMEZONE
    || !Array.isArray(value.holidays)
    || !Array.isArray(value.adjustedWorkdays)) {
    throw new Error('Invalid China workday calendar.');
  }
  return value as WorkdayCalendar;
}

export function getShanghaiDateTime(date: Date): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    timeZone: TIMEZONE,
    year: 'numeric',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}
