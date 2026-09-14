import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY,
  type MorningBriefingPolicyRecord,
} from '@weiling-ai/db';
import { resolveBotInstancePaths } from '@weiling-ai/shared';
import {
  classifyMorningBriefingDeliveryFailure,
  findNextWorkdaySlot,
  getMorningBriefingRetrySchedule,
  MorningBriefingScheduler,
  OpenMeteoMorningBriefingWeatherProvider,
} from '../morning-briefing-scheduler';

const calendar = {
  adjustedWorkdays: ['2026-02-14'],
  holidays: ['2026-07-20'],
  timezone: 'Asia/Shanghai',
  year: 2026,
};
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('MorningBriefingScheduler', () => {
  it('plans a central schedule before the configured delivery time', async () => {
    const fixture = await createFixture(createPolicy());

    await fixture.scheduler.runOnce(new Date('2026-08-10T00:00:00.000Z'));

    expect(fixture.policies.updateCentralSchedule).toHaveBeenCalledWith(
      'bot_1',
      '2026-08-10T00:30:00.000Z',
      new Date('2026-08-10T00:00:00.000Z'),
    );
    expect(fixture.processManager.sendAdminMessage).not.toHaveBeenCalled();
  });

  it('delivers a deterministic personal briefing and advances to the next workday', async () => {
    const fixture = await createFixture(createPolicy({
      centralScheduledFor: '2026-08-10T00:30:00.000Z',
    }));
    await writeTasks(fixture.instancesRoot, [{
      createdAt: '2026-07-20T00:00:00.000Z',
      dueDate: '2026-07-22',
      id: 'task_1',
      priority: 'high',
      status: 'pending',
      title: '提交项目周报',
    }, {
      createdAt: '2026-07-20T00:00:00.000Z',
      dueDate: '2026-08-10',
      id: 'task_2',
      priority: 'normal',
      status: 'pending',
      title: '整理客户反馈',
    }]);

    await fixture.scheduler.runOnce(new Date('2026-08-10T00:30:00.000Z'));

    expect(fixture.processManager.sendAdminMessage).toHaveBeenCalledWith(
      'bot_1',
      'morning:bot_1:2026-08-10',
      expect.stringMatching(/^早上好，我是微Link。[\s\S]*北京天气：[\s\S]*逾期事项：[\s\S]*提交项目周报[\s\S]*今日计划：[\s\S]*整理客户反馈/),
      'morning:bot_1:2026-08-10',
    );
    expect(fixture.policies.markCentralDeliverySucceeded).toHaveBeenCalledWith('bot_1', {
      deliveredAt: new Date('2026-08-10T00:30:00.000Z'),
      deliveryDate: '2026-08-10',
      nextScheduledFor: '2026-08-11T00:30:00.000Z',
    });
  });

  it('reads a legacy task store while users migrate to the weiling workspace directory', async () => {
    const fixture = await createFixture(createPolicy({
      centralScheduledFor: '2026-08-10T00:30:00.000Z',
    }));
    await writeTasks(fixture.instancesRoot, [{
      createdAt: '2026-07-20T00:00:00.000Z',
      dueDate: '2026-08-10',
      id: 'legacy_task',
      priority: 'normal',
      status: 'pending',
      title: '迁移前的任务',
    }], '.gaozhiling');

    await fixture.scheduler.runOnce(new Date('2026-08-10T00:30:00.000Z'));

    expect(fixture.processManager.sendAdminMessage).toHaveBeenCalledWith(
      'bot_1',
      'morning:bot_1:2026-08-10',
      expect.stringContaining('迁移前的任务'),
      'morning:bot_1:2026-08-10',
    );
  });

  it('uses the latest configured intro for a morning briefing', async () => {
    const fixture = await createFixture(createPolicy({
      centralScheduledFor: '2026-08-10T00:30:00.000Z',
    }));
    fixture.messageCopy.getCopy.mockResolvedValue({
      ...DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY,
      assistantName: '测试助手',
      morningBriefingIntro: '测试助手晨报 {{date}}',
    });

    await fixture.scheduler.runOnce(new Date('2026-08-10T00:31:00.000Z'));

    expect(fixture.processManager.sendAdminMessage).toHaveBeenCalledWith(
      'bot_1',
      'morning:bot_1:2026-08-10',
      expect.stringMatching(/^测试助手晨报 2026-08-10 星期一/),
      'morning:bot_1:2026-08-10',
    );
  });

  it('persists a delayed retry when the Bot is offline', async () => {
    const fixture = await createFixture(createPolicy({
      centralScheduledFor: '2026-08-10T00:30:00.000Z',
    }));
    fixture.processManager.sendAdminMessage.mockRejectedValue(
      new Error('Bot process is not running.'),
    );

    await fixture.scheduler.runOnce(new Date('2026-08-10T00:31:00.000Z'));

    expect(fixture.policies.markCentralDeliveryFailed).toHaveBeenCalledWith('bot_1', {
      deliveryDate: '2026-08-10',
      error: 'Bot process is not running.',
      failedAt: new Date('2026-08-10T00:31:00.000Z'),
      nextScheduledFor: '2026-08-11T00:30:00.000Z',
    });
    expect(fixture.policies.markCentralDeliverySucceeded).not.toHaveBeenCalled();
    expect(fixture.adminMessageDispatcher.sendAdminMessage).toHaveBeenCalledWith(
      'bot_1',
      'morning:bot_1:2026-08-10',
      expect.any(String),
      'morning:bot_1:2026-08-10',
    );
  });

  it('defers an unavailable Weixin conversation into the delivery queue', async () => {
    const fixture = await createFixture(createPolicy({
      centralScheduledFor: '2026-08-10T00:30:00.000Z',
    }));
    fixture.processManager.sendAdminMessage.mockRejectedValue(
      new Error('Weixin API request failed: 200 (ret=-2, errcode=n/a, prepare failed)'),
    );

    await fixture.scheduler.runOnce(new Date('2026-08-10T00:31:00.000Z'));

    expect(fixture.policies.markCentralDeliveryFailed).toHaveBeenCalledWith('bot_1', {
      deliveryDate: '2026-08-10',
      error: 'Weixin API request failed: 200 (ret=-2, errcode=n/a, prepare failed)',
      failedAt: new Date('2026-08-10T00:31:00.000Z'),
      nextScheduledFor: '2026-08-11T00:30:00.000Z',
    });
    expect(fixture.adminMessageDispatcher.sendAdminMessage).toHaveBeenCalledWith(
      'bot_1',
      'morning:bot_1:2026-08-10',
      expect.any(String),
      'morning:bot_1:2026-08-10',
    );
  });

  it('does not attempt delivery before a persisted retry schedule', async () => {
    const fixture = await createFixture(createPolicy({
      centralLastError: 'temporary failure',
      centralScheduledFor: '2026-08-10T00:36:00.000Z',
    }));

    await fixture.scheduler.runOnce(new Date('2026-08-10T00:31:00.000Z'));

    expect(fixture.processManager.sendAdminMessage).not.toHaveBeenCalled();
    expect(fixture.policies.markCentralDeliveryFailed).not.toHaveBeenCalled();
  });

  it('clears central scheduling when the employee opted out', async () => {
    const fixture = await createFixture(createPolicy({
      centralScheduledFor: '2026-08-10T00:30:00.000Z',
      observedUserOptOut: true,
    }));

    await fixture.scheduler.runOnce(new Date('2026-08-10T00:30:00.000Z'));

    expect(fixture.policies.updateCentralSchedule).toHaveBeenCalledWith(
      'bot_1',
      null,
      new Date('2026-08-10T00:30:00.000Z'),
    );
    expect(fixture.processManager.sendAdminMessage).not.toHaveBeenCalled();
  });

  it('lets one valid legacy cron finish migration day without double delivery', async () => {
    const fixture = await createFixture(createPolicy({
      centralScheduledFor: '2026-08-10T00:30:00.000Z',
      runtimeScheduledFor: '2026-08-10T08:30:00+08:00',
      runtimeScheduleTaskId: 'cron_legacy',
    }));

    await fixture.scheduler.runOnce(new Date('2026-08-10T00:30:00.000Z'));

    expect(fixture.processManager.sendAdminMessage).not.toHaveBeenCalled();
    expect(fixture.policies.updateCentralSchedule).toHaveBeenCalledWith(
      'bot_1',
      '2026-08-11T00:30:00.000Z',
      new Date('2026-08-10T00:30:00.000Z'),
    );
  });
});

it('retries Open-Meteo geocoding with a Chinese city suffix', async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ generationtime_ms: 0.1 }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      results: [{ latitude: 24.47979, longitude: 118.08187 }],
    }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      daily: {
        precipitation_probability_max: [94],
        temperature_2m_max: [34.7],
        temperature_2m_min: [26],
        time: ['2026-08-06'],
        weather_code: [55],
      },
    }), { status: 200 }));
  const provider = new OpenMeteoMorningBriefingWeatherProvider(fetchImpl as typeof fetch);

  await expect(provider.lookup('北京', '2026-08-06')).resolves.toEqual({
    condition: '有雨',
    maximumTemperature: 34.7,
    minimumTemperature: 26,
    precipitationProbability: 94,
  });
  expect(new URL(String(fetchImpl.mock.calls[0][0])).searchParams.get('name')).toBe('北京');
  expect(new URL(String(fetchImpl.mock.calls[1][0])).searchParams.get('name')).toBe('北京市');
  expect(new URL(String(fetchImpl.mock.calls[2][0])).hostname).toBe('api.open-meteo.com');
});

it('retries transient Open-Meteo failures before caching a successful result', async () => {
  const sleepImpl = vi.fn().mockResolvedValue(undefined);
  const fetchImpl = vi.fn()
    .mockRejectedValueOnce(new TypeError('fetch failed'))
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      results: [{ latitude: 24.47979, longitude: 118.08187 }],
    }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      daily: {
        precipitation_probability_max: [94],
        temperature_2m_max: [34.7],
        temperature_2m_min: [26],
        time: ['2026-08-06'],
        weather_code: [55],
      },
    }), { status: 200 }));
  const provider = new OpenMeteoMorningBriefingWeatherProvider(
    fetchImpl as typeof fetch,
    sleepImpl,
  );

  await expect(provider.lookup('Xiamen', '2026-08-06')).resolves.toMatchObject({
    condition: '有雨',
  });
  expect(fetchImpl).toHaveBeenCalledTimes(4);
  expect(sleepImpl.mock.calls).toEqual([[250], [750]]);
});

it('evicts a rejected Open-Meteo request so a later lookup can recover', async () => {
  const sleepImpl = vi.fn().mockResolvedValue(undefined);
  const fetchImpl = vi.fn()
    .mockRejectedValueOnce(new TypeError('fetch failed'))
    .mockRejectedValueOnce(new TypeError('fetch failed'))
    .mockRejectedValueOnce(new TypeError('fetch failed'))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      results: [{ latitude: 24.47979, longitude: 118.08187 }],
    }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      daily: {
        precipitation_probability_max: [94],
        temperature_2m_max: [34.7],
        temperature_2m_min: [26],
        time: ['2026-08-06'],
        weather_code: [55],
      },
    }), { status: 200 }));
  const provider = new OpenMeteoMorningBriefingWeatherProvider(
    fetchImpl as typeof fetch,
    sleepImpl,
  );

  await expect(provider.lookup('Xiamen', '2026-08-06')).rejects.toThrow('fetch failed');
  await expect(provider.lookup('Xiamen', '2026-08-06')).resolves.toMatchObject({
    condition: '有雨',
  });
  expect(fetchImpl).toHaveBeenCalledTimes(5);
});

it('does not retry a non-retryable Open-Meteo client response', async () => {
  const sleepImpl = vi.fn().mockResolvedValue(undefined);
  const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));
  const provider = new OpenMeteoMorningBriefingWeatherProvider(
    fetchImpl as typeof fetch,
    sleepImpl,
  );

  await expect(provider.lookup('Xiamen', '2026-08-06')).rejects.toThrow(
    'Weather geocoding failed with status 400.',
  );
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(sleepImpl).not.toHaveBeenCalled();
});

it('schedules morning briefings on the next workday', () => {
  expect(findNextWorkdaySlot(
    new Date('2026-08-12T04:00:00.000Z'),
    '08:30',
    calendar,
    false,
  )).toBe('2026-08-13T00:30:00.000Z');

  expect(findNextWorkdaySlot(
    new Date('2026-08-10T00:10:00.000Z'),
    '08:30',
    calendar,
    false,
  )).toBe('2026-08-10T00:30:00.000Z');

  expect(findNextWorkdaySlot(
    new Date('2026-08-10T01:00:00.000Z'),
    '08:30',
    calendar,
    false,
  )).toBe('2026-08-11T00:30:00.000Z');

  expect(findNextWorkdaySlot(
    new Date('2026-08-10T01:00:00.000Z'),
    '08:30',
    calendar,
    true,
  )).toBe('2026-08-10T00:30:00.000Z');

  expect(findNextWorkdaySlot(
    new Date('2026-08-14T04:00:00.000Z'),
    '08:30',
    calendar,
    false,
  )).toBe('2026-08-17T00:30:00.000Z');

  expect(findNextWorkdaySlot(
    new Date('2026-07-17T04:00:00.000Z'),
    '08:30',
    calendar,
    false,
  )).toBe('2026-07-21T00:30:00.000Z');
});

it('classifies durable delivery retry plans', () => {
  expect(classifyMorningBriefingDeliveryFailure(
    'Expected exactly one active binding, found 0.',
  )).toBe('waiting-for-conversation');
  expect(classifyMorningBriefingDeliveryFailure(
    'Bot process IPC channel is unavailable.',
  )).toBe('bot-unavailable');
  expect(classifyMorningBriefingDeliveryFailure('fetch failed')).toBe('transient');
  expect(getMorningBriefingRetrySchedule({
    calendar,
    deliveryTime: '08:30',
    error: 'fetch failed',
    now: new Date('2026-08-10T00:31:00.000Z'),
  })).toBe('2026-08-10T00:36:00.000Z');
});

async function createFixture(policy: MorningBriefingPolicyRecord) {
  const root = await mkdtemp(join(tmpdir(), 'weiling-central-briefing-'));
  tempDirs.push(root);
  const instancesRoot = join(root, 'instances');
  const policies = {
    ensureForAllBots: vi.fn().mockResolvedValue([]),
    listAll: vi.fn().mockResolvedValue([policy]),
    markCentralDeliveryFailed: vi.fn().mockResolvedValue(undefined),
    markCentralDeliverySucceeded: vi.fn().mockResolvedValue(undefined),
    updateCentralSchedule: vi.fn().mockResolvedValue(undefined),
  };
  const processManager = { sendAdminMessage: vi.fn().mockResolvedValue(undefined) };
  const messageCopy = {
    getCopy: vi.fn().mockResolvedValue(DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY),
  };
  const weatherProvider = {
    lookup: vi.fn().mockResolvedValue({
      condition: '阵雨',
      maximumTemperature: 31,
      minimumTemperature: 26,
      precipitationProbability: 70,
    }),
  };
  const adminMessageDispatcher = { sendAdminMessage: vi.fn().mockResolvedValue(undefined) };
  return {
    adminMessageDispatcher,
    instancesRoot,
    messageCopy,
    policies,
    processManager,
    scheduler: new MorningBriefingScheduler({
      adminMessageDispatcher: adminMessageDispatcher as never,
      calendar,
      instancesRoot,
      messageCopy,
      policies: policies as never,
      processManager,
      weatherProvider,
      workspaceRoot: root,
    }),
  };
}

async function writeTasks(instancesRoot: string, tasks: unknown[], stateDirectory = '.weiling') {
  const { workspaceDir } = resolveBotInstancePaths(instancesRoot, 'bot_1');
  const stateDir = join(workspaceDir, stateDirectory);
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(stateDir, 'work-tasks.json'), `${JSON.stringify({
    schemaVersion: 1,
    tasks,
  }, null, 2)}\n`);
}

function createPolicy(
  overrides: Partial<MorningBriefingPolicyRecord> = {},
): MorningBriefingPolicyRecord {
  return {
    adminEnabled: true,
    appliedRevision: 1,
    botInstanceId: 'bot_1',
    centralLastDeliveredAt: null,
    centralLastDeliveryDate: null,
    centralLastError: null,
    centralScheduledFor: null,
    createdAt: new Date('2026-07-20T00:00:00.000Z'),
    deliveryTime: '08:30',
    desiredRevision: 1,
    forceEnabled: false,
    lastSyncError: null,
    lastSyncedAt: new Date('2026-07-20T00:00:00.000Z'),
    location: '北京',
    observedUserOptOut: false,
    runtimeNeedsCleanup: false,
    runtimeNeedsSchedule: false,
    runtimeObservedAt: new Date('2026-07-20T00:00:00.000Z'),
    runtimeScheduledFor: null,
    runtimeScheduleTaskId: null,
    syncStatus: 'synced',
    timezone: 'Asia/Shanghai',
    updatedAt: new Date('2026-07-20T00:00:00.000Z'),
    ...overrides,
  };
}
