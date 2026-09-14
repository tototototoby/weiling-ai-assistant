import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY,
  type GlobalAdminMessageCopy,
  type MorningBriefingPolicyRecord,
  type MorningBriefingPolicyRepository,
} from '@weiling-ai/db';
import { resolveBotInstancePaths } from '@weiling-ai/shared';
import type { AdminMessageSender } from './admin-message-dispatcher';
import {
  type AdminMessageCopyProvider,
  renderAdminMessageCopy,
} from './admin-message-copy';
import {
  getShanghaiDateTime,
  isWorkday,
  type WorkdayCalendar,
} from './meal-reminder-scheduler';

const TIMEZONE = 'Asia/Shanghai';
const BRIEFING_STATE_DIRECTORY = '.weiling';
const LEGACY_BRIEFING_STATE_DIRECTORY = '.gaozhiling';
const MAX_TASK_FILE_BYTES = 1024 * 1024;
const DELIVERY_CONCURRENCY = 5;
const TRANSIENT_RETRY_DELAY_MS = 5 * 60 * 1000;
const BOT_UNAVAILABLE_RETRY_DELAY_MS = 15 * 60 * 1000;
const WEATHER_FETCH_TIMEOUT_MS = 5_000;
const WEATHER_FETCH_RETRY_DELAYS_MS = [250, 750] as const;

export type MorningBriefingDeliveryFailureKind =
  | 'bot-unavailable'
  | 'transient'
  | 'waiting-for-conversation';

interface WorkTask {
  createdAt: string;
  dueDate: string | null;
  priority: 'high' | 'low' | 'normal';
  status: string;
  title: string;
}

interface TaskSummary {
  invalid: boolean;
  overdue: WorkTask[];
  today: WorkTask[];
  undated: WorkTask[];
}

export interface MorningBriefingWeather {
  condition: string;
  maximumTemperature: number;
  minimumTemperature: number;
  precipitationProbability: number | null;
}

export interface MorningBriefingWeatherProvider {
  lookup(location: string, date: string): Promise<MorningBriefingWeather | null>;
}

type MorningBriefingPolicyStore = Pick<
  MorningBriefingPolicyRepository,
  | 'ensureForAllBots'
  | 'listAll'
  | 'markCentralDeliveryFailed'
  | 'markCentralDeliverySucceeded'
  | 'updateCentralSchedule'
>;

export interface MorningBriefingSchedulerDependencies {
  adminMessageDispatcher?: AdminMessageSender;
  calendar?: WorkdayCalendar;
  fetchImpl?: typeof fetch;
  instancesRoot: string;
  messageCopy: AdminMessageCopyProvider;
  policies: MorningBriefingPolicyStore;
  processManager: AdminMessageSender;
  weatherProvider?: MorningBriefingWeatherProvider;
  workspaceRoot: string;
}

export class MorningBriefingScheduler {
  private activePass: Promise<void> | null = null;
  private readonly adminMessageDispatcher?: AdminMessageSender;
  private calendar: WorkdayCalendar | null;
  private readonly instancesRoot: string;
  private readonly messageCopy: AdminMessageCopyProvider;
  private readonly policies: MorningBriefingPolicyStore;
  private readonly processManager: AdminMessageSender;
  private readonly weatherProvider: MorningBriefingWeatherProvider;
  private readonly workspaceRoot: string;

  constructor(dependencies: MorningBriefingSchedulerDependencies) {
    this.adminMessageDispatcher = dependencies.adminMessageDispatcher;
    this.calendar = dependencies.calendar ?? null;
    this.instancesRoot = dependencies.instancesRoot;
    this.messageCopy = dependencies.messageCopy;
    this.policies = dependencies.policies;
    this.processManager = dependencies.processManager;
    this.weatherProvider = dependencies.weatherProvider
      ?? new OpenMeteoMorningBriefingWeatherProvider(dependencies.fetchImpl ?? fetch);
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

  private async runPass(now: Date): Promise<void> {
    const calendar = await this.getCalendar();
    const copy = await this.messageCopy.getCopy();
    await this.policies.ensureForAllBots(now);
    const policies = await this.policies.listAll();

    await mapWithConcurrency(policies, DELIVERY_CONCURRENCY, async (policy) => {
      try {
        await this.processPolicy(policy, calendar, copy, now);
      } catch (error) {
        console.error(`Morning briefing scheduling failed [${policy.botInstanceId}]`);
        console.error(error);
      }
    });
  }

  private async processPolicy(
    policy: MorningBriefingPolicyRecord,
    calendar: WorkdayCalendar,
    copy: Readonly<GlobalAdminMessageCopy>,
    now: Date,
  ): Promise<void> {
    const effectiveEnabled = policy.adminEnabled
      && (!policy.observedUserOptOut || policy.forceEnabled);

    if (!effectiveEnabled) {
      if (policy.centralScheduledFor !== null) {
        await this.policies.updateCentralSchedule(policy.botInstanceId, null, now);
      }
      return;
    }

    const local = getShanghaiDateTime(now);
    let scheduledFor = normalizeScheduledFor(policy, calendar, now);

    if (scheduledFor !== policy.centralScheduledFor) {
      await this.policies.updateCentralSchedule(policy.botInstanceId, scheduledFor, now);
    }

    if (Date.parse(scheduledFor) > now.getTime()) return;

    const deliveryDate = toShanghaiDate(scheduledFor);
    if (shouldDeferToLegacyCron(policy, deliveryDate)) {
      const nextScheduledFor = findNextWorkdaySlot(now, policy.deliveryTime, calendar, false);
      await this.policies.updateCentralSchedule(policy.botInstanceId, nextScheduledFor, now);
      return;
    }

    const [tasks, weather] = await Promise.all([
      this.readTaskSummary(policy.botInstanceId, local.date),
      this.lookupWeather(policy.location, local.date),
    ]);
    const message = buildMorningBriefingMessage({
      assistantName: copy.assistantName,
      date: local.date,
      introTemplate: copy.morningBriefingIntro,
      location: policy.location,
      tasks,
      weather,
    });
    const semanticKey = `morning:${policy.botInstanceId}:${local.date}`;

    try {
      await this.processManager.sendAdminMessage(
        policy.botInstanceId,
        semanticKey,
        message,
        semanticKey,
      );
      const nextScheduledFor = findNextWorkdaySlot(now, policy.deliveryTime, calendar, false);
      await this.policies.markCentralDeliverySucceeded(policy.botInstanceId, {
        deliveredAt: now,
        deliveryDate: local.date,
        nextScheduledFor,
      });
    } catch (error) {
      const errorMessage = formatError(error);
      if (this.adminMessageDispatcher) {
        try {
          await this.adminMessageDispatcher.sendAdminMessage(
            policy.botInstanceId,
            semanticKey,
            message,
            semanticKey,
          );
        } catch (queueError) {
          console.error(`Morning briefing queue enqueue failed [${policy.botInstanceId}]`);
          console.error(queueError);
        }
      }
      await this.policies.markCentralDeliveryFailed(policy.botInstanceId, {
        deliveryDate,
        error: errorMessage,
        failedAt: now,
        nextScheduledFor: findNextWorkdaySlot(now, policy.deliveryTime, calendar, false),
      });
    }
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

  private async readTaskSummary(botInstanceId: string, date: string): Promise<TaskSummary> {
    const { workspaceDir } = resolveBotInstancePaths(this.instancesRoot, botInstanceId);
    const filePaths = [
      join(workspaceDir, BRIEFING_STATE_DIRECTORY, 'work-tasks.json'),
      join(workspaceDir, LEGACY_BRIEFING_STATE_DIRECTORY, 'work-tasks.json'),
    ];

    for (const filePath of filePaths) {
      try {
        const stats = await lstat(filePath);
        if (stats.isSymbolicLink() || !stats.isFile() || stats.size > MAX_TASK_FILE_BYTES) {
          throw new Error('Morning briefing task file is unsafe or too large.');
        }
        return summarizeTasks(JSON.parse(await readFile(filePath, 'utf8')), date);
      } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') continue;
        console.error(`Morning briefing task lookup failed [${botInstanceId}]`);
        console.error(error);
        return emptyTaskSummary(true);
      }
    }

    return emptyTaskSummary(false);
  }

  private async lookupWeather(
    location: string,
    date: string,
  ): Promise<MorningBriefingWeather | null> {
    try {
      return await this.weatherProvider.lookup(location, date);
    } catch (error) {
      console.error(`Morning briefing weather lookup failed [${location}]`);
      console.error(error);
      return null;
    }
  }
}

export class OpenMeteoMorningBriefingWeatherProvider implements MorningBriefingWeatherProvider {
  private readonly cache = new Map<string, Promise<MorningBriefingWeather | null>>();

  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly sleepImpl: (delayMs: number) => Promise<void> = sleep,
  ) {}

  async lookup(location: string, date: string): Promise<MorningBriefingWeather | null> {
    const key = `${date}:${location}`;
    const existing = this.cache.get(key);
    if (existing) return existing;
    for (const cachedKey of this.cache.keys()) {
      if (!cachedKey.startsWith(`${date}:`)) this.cache.delete(cachedKey);
    }
    const request = this.request(location, date);
    this.cache.set(key, request);
    try {
      return await request;
    } catch (error) {
      if (this.cache.get(key) === request) this.cache.delete(key);
      throw error;
    }
  }

  private async request(location: string, date: string): Promise<MorningBriefingWeather | null> {
    let coordinates: { latitude: number; longitude: number } | null = null;
    for (const candidate of getOpenMeteoLocationCandidates(location)) {
      const geocodingUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
      geocodingUrl.searchParams.set('name', candidate);
      geocodingUrl.searchParams.set('count', '1');
      geocodingUrl.searchParams.set('language', 'zh');
      geocodingUrl.searchParams.set('format', 'json');
      const geocodingResponse = await this.fetchWithRetry(geocodingUrl, 'geocoding');
      coordinates = parseCoordinates(await geocodingResponse.json());
      if (coordinates) break;
    }
    if (!coordinates) return null;

    const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast');
    forecastUrl.searchParams.set('latitude', String(coordinates.latitude));
    forecastUrl.searchParams.set('longitude', String(coordinates.longitude));
    forecastUrl.searchParams.set('timezone', TIMEZONE);
    forecastUrl.searchParams.set('start_date', date);
    forecastUrl.searchParams.set('end_date', date);
    forecastUrl.searchParams.set(
      'daily',
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    );
    const forecastResponse = await this.fetchWithRetry(forecastUrl, 'forecast');
    return parseForecast(await forecastResponse.json(), date);
  }

  private async fetchWithRetry(url: URL, operation: 'forecast' | 'geocoding'): Promise<Response> {
    for (let attempt = 0; attempt <= WEATHER_FETCH_RETRY_DELAYS_MS.length; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          signal: AbortSignal.timeout(WEATHER_FETCH_TIMEOUT_MS),
        });
      } catch (error) {
        const retryDelay = WEATHER_FETCH_RETRY_DELAYS_MS[attempt];
        if (retryDelay === undefined) throw error;
        await this.sleepImpl(retryDelay);
        continue;
      }
      if (response.ok) return response;
      const retryDelay = WEATHER_FETCH_RETRY_DELAYS_MS[attempt];
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || retryDelay === undefined) {
        throw new Error(`Weather ${operation} failed with status ${response.status}.`);
      }
      await this.sleepImpl(retryDelay);
    }
    throw new Error(`Weather ${operation} retry loop exhausted.`);
  }
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function getOpenMeteoLocationCandidates(location: string): string[] {
  const normalized = location.normalize('NFKC').trim();
  if (!normalized) return [];
  const candidates = [normalized];
  if (/^\p{Script=Han}{2,12}$/u.test(normalized) && !/[市县区州省盟旗]$/u.test(normalized)) {
    candidates.push(`${normalized}市`);
  }
  return candidates;
}

function normalizeScheduledFor(
  policy: MorningBriefingPolicyRecord,
  calendar: WorkdayCalendar,
  now: Date,
): string {
  const local = getShanghaiDateTime(now);
  const current = policy.centralScheduledFor;
  const currentDate = current && Number.isFinite(Date.parse(current))
    ? toShanghaiDate(current)
    : null;
  const canKeepCurrent = current !== null
    && currentDate !== null
    && currentDate === local.date
    && policy.centralLastDeliveryDate !== currentDate;

  if (canKeepCurrent) return current;
  const allowElapsedToday = policy.centralLastDeliveryDate !== local.date;
  return findNextWorkdaySlot(now, policy.deliveryTime, calendar, allowElapsedToday);
}

export function findNextWorkdaySlot(
  now: Date,
  deliveryTime: string,
  calendar: WorkdayCalendar,
  allowElapsedToday: boolean,
): string {
  const local = getShanghaiDateTime(now);
  const [hour, minute] = deliveryTime.split(':').map(Number);
  const candidate = new Date(`${local.date}T${pad(hour)}:${pad(minute)}:00+08:00`);
  if (!allowElapsedToday && candidate.getTime() <= now.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  while (!isWorkday(toShanghaiDate(candidate.toISOString()), calendar)) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate.toISOString();
}

export function classifyMorningBriefingDeliveryFailure(
  error: string,
): MorningBriefingDeliveryFailureKind {
  if (
    /ret=-2/i.test(error)
    || /prepare failed/i.test(error)
    || /exactly one active binding, found 0/i.test(error)
    || /weixin account .* is not configured/i.test(error)
    || /context[_ ]token/i.test(error)
  ) {
    return 'waiting-for-conversation';
  }

  if (
    /bot process is not running/i.test(error)
    || /bot process ipc channel is unavailable/i.test(error)
    || /bot process (?:exited|stopped)/i.test(error)
  ) {
    return 'bot-unavailable';
  }

  return 'transient';
}

export function isWaitingForConversationError(error: string): boolean {
  return classifyMorningBriefingDeliveryFailure(error) === 'waiting-for-conversation';
}

export function getMorningBriefingRetrySchedule(input: {
  calendar: WorkdayCalendar;
  deliveryTime: string;
  error: string;
  now: Date;
}): string {
  const failureKind = classifyMorningBriefingDeliveryFailure(input.error);

  if (failureKind === 'waiting-for-conversation') {
    return findNextWorkdaySlot(input.now, input.deliveryTime, input.calendar, false);
  }

  const delay = failureKind === 'bot-unavailable'
    ? BOT_UNAVAILABLE_RETRY_DELAY_MS
    : TRANSIENT_RETRY_DELAY_MS;
  const candidate = new Date(input.now.getTime() + delay);
  const currentDate = getShanghaiDateTime(input.now).date;
  const candidateDate = getShanghaiDateTime(candidate).date;

  if (candidateDate !== currentDate || !isWorkday(candidateDate, input.calendar)) {
    return findNextWorkdaySlot(input.now, input.deliveryTime, input.calendar, false);
  }

  return candidate.toISOString();
}

function shouldDeferToLegacyCron(
  policy: MorningBriefingPolicyRecord,
  deliveryDate: string,
): boolean {
  return Boolean(
    policy.runtimeScheduleTaskId
    && policy.runtimeScheduledFor
    && Number.isFinite(Date.parse(policy.runtimeScheduledFor))
    && toShanghaiDate(policy.runtimeScheduledFor) === deliveryDate,
  );
}

function summarizeTasks(value: unknown, date: string): TaskSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Morning briefing task store must be an object.');
  }
  const store = value as { schemaVersion?: unknown; tasks?: unknown };
  if (store.schemaVersion !== 1 || !Array.isArray(store.tasks)) {
    throw new Error('Morning briefing task store has an unsupported schema.');
  }

  const tasks = store.tasks.map(parseTask).filter((task) => task.status === 'pending');
  const rank = { high: 0, normal: 1, low: 2 } as const;
  tasks.sort((left, right) => (
    rank[left.priority] - rank[right.priority]
    || (left.dueDate ?? '9999').localeCompare(right.dueDate ?? '9999')
    || left.createdAt.localeCompare(right.createdAt)
  ));

  return {
    invalid: false,
    overdue: tasks.filter((task) => task.dueDate !== null && task.dueDate < date).slice(0, 5),
    today: tasks.filter((task) => task.dueDate === date).slice(0, 8),
    undated: tasks.filter((task) => task.dueDate === null).slice(0, 3),
  };
}

function parseTask(value: unknown): WorkTask {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Morning briefing task entry must be an object.');
  }
  const task = value as Record<string, unknown>;
  const title = typeof task.title === 'string' ? task.title.trim() : '';
  const dueDate = task.dueDate === null ? null : String(task.dueDate ?? '');
  const priority = task.priority;
  if (!title || /[\r\n\0]/.test(title) || title.length > 300) {
    throw new Error('Morning briefing task title is invalid.');
  }
  if (dueDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw new Error('Morning briefing task due date is invalid.');
  }
  if (priority !== 'high' && priority !== 'normal' && priority !== 'low') {
    throw new Error('Morning briefing task priority is invalid.');
  }
  return {
    createdAt: typeof task.createdAt === 'string' ? task.createdAt : '',
    dueDate,
    priority,
    status: typeof task.status === 'string' ? task.status : '',
    title,
  };
}

export function buildMorningBriefingMessage(input: {
  assistantName?: string;
  date: string;
  introTemplate?: string;
  location: string;
  tasks: TaskSummary;
  weather: MorningBriefingWeather | null;
}): string {
  const weekday = new Intl.DateTimeFormat('zh-CN', {
    timeZone: TIMEZONE,
    weekday: 'long',
  }).format(new Date(`${input.date}T12:00:00+08:00`));
  const introTemplate = input.introTemplate
    ?? '早上好，我是{{assistantName}}。今天是 {{date}}。';
  const lines = [renderAdminMessageCopy(introTemplate, {
    assistantName: input.assistantName ?? DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY.assistantName,
    city: input.location,
    date: `${input.date} ${weekday}`,
  })];

  if (input.weather) {
    const rain = input.weather.precipitationProbability === null
      ? ''
      : `，最高降雨概率 ${Math.round(input.weather.precipitationProbability)}%`;
    lines.push(
      `${input.location}天气：${input.weather.condition}，${Math.round(input.weather.minimumTemperature)}~${Math.round(input.weather.maximumTemperature)}°C${rain}。`,
    );
    lines.push(
      input.weather.condition.includes('雨')
        || (input.weather.precipitationProbability ?? 0) >= 50
        ? '出行建议：带伞并为通勤预留更多时间。'
        : '出行建议：按常规通勤节奏安排即可。',
    );
  } else {
    lines.push(`${input.location}天气信息暂时不可用，工作计划仍按时送达。`);
  }

  if (input.tasks.invalid) {
    lines.push('工作任务清单暂时无法读取，请在微信里让我检查任务设置。');
  } else if (
    input.tasks.overdue.length === 0
    && input.tasks.today.length === 0
    && input.tasks.undated.length === 0
  ) {
    lines.push('今天暂无已登记的工作任务。');
  } else {
    appendTaskSection(lines, '逾期事项', input.tasks.overdue);
    appendTaskSection(lines, '今日计划', input.tasks.today);
    appendTaskSection(lines, '待安排事项', input.tasks.undated);
  }

  lines.push(input.tasks.overdue.length > 0
    ? '建议：先处理一项逾期高优先级任务，再推进今天的重点事项。'
    : '建议：先确认今天最重要的一项任务，并为它预留不被打断的时间。');
  return lines.join('\n');
}

function appendTaskSection(lines: string[], title: string, tasks: WorkTask[]): void {
  if (tasks.length === 0) return;
  lines.push(`${title}：`);
  tasks.forEach((task, index) => {
    lines.push(`${index + 1}. ${task.title}${task.priority === 'high' ? '（高优先级）' : ''}`);
  });
}

function parseCoordinates(value: unknown): { latitude: number; longitude: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const results = (value as { results?: unknown }).results;
  if (!Array.isArray(results) || results.length === 0) return null;
  const first = results[0] as { latitude?: unknown; longitude?: unknown };
  const latitude = Number(first.latitude);
  const longitude = Number(first.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

function parseForecast(value: unknown, date: string): MorningBriefingWeather | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const daily = (value as { daily?: unknown }).daily;
  if (!daily || typeof daily !== 'object' || Array.isArray(daily)) return null;
  const data = daily as Record<string, unknown>;
  const times = data.time;
  if (!Array.isArray(times)) return null;
  const index = times.indexOf(date);
  if (index < 0) return null;
  const code = readArrayNumber(data.weather_code, index);
  const maximumTemperature = readArrayNumber(data.temperature_2m_max, index);
  const minimumTemperature = readArrayNumber(data.temperature_2m_min, index);
  const precipitationProbability = readArrayNumber(data.precipitation_probability_max, index, true);
  if (code === null || maximumTemperature === null || minimumTemperature === null) return null;
  return {
    condition: describeWeatherCode(code),
    maximumTemperature,
    minimumTemperature,
    precipitationProbability,
  };
}

function readArrayNumber(value: unknown, index: number, nullable = false): number | null {
  if (!Array.isArray(value)) return null;
  if (nullable && value[index] === null) return null;
  const number = Number(value[index]);
  return Number.isFinite(number) ? number : null;
}

function describeWeatherCode(code: number): string {
  if (code === 0) return '晴';
  if (code <= 3) return '多云';
  if (code === 45 || code === 48) return '有雾';
  if (code >= 51 && code <= 67) return '有雨';
  if (code >= 71 && code <= 77) return '有雪';
  if (code >= 80 && code <= 82) return '阵雨';
  if (code >= 85 && code <= 86) return '阵雪';
  if (code >= 95) return '雷雨';
  return '天气多变';
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

function toShanghaiDate(value: string): string {
  return getShanghaiDateTime(new Date(value)).date;
}

function emptyTaskSummary(invalid: boolean): TaskSummary {
  return { invalid, overdue: [], today: [], undated: [] };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

async function mapWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (index < values.length) {
      const value = values[index];
      index += 1;
      await operation(value);
    }
  });
  await Promise.all(workers);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
