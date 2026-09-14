import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  BotEventRepository,
  BotInstanceRepository,
  UserRepository,
  WorkspaceRepository,
  migrateDatabase,
} from '@weiling-ai/db';
import {
  closeTrackedDatabaseClients,
  createTrackedDatabaseClient as createDatabaseClient,
} from './test-database-client';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastAgentJsonlEvent } from '@weiling-ai/shared';
import { applyFastAgentEvent } from '../event-applier';
import { parseFastAgentJsonlOutput } from '../fastagent-cli-contract';
import { getProcessStartedAt } from '../process-identity';

const tempDirs: string[] = [];
const tempChildren: Array<ReturnType<typeof spawn>> = [];

afterEach(async () => {
  closeTrackedDatabaseClients();
  await Promise.all(tempChildren.splice(0).map(async (child) => {
    if (child.exitCode === null && !child.killed) {
      child.kill('SIGKILL');
    }
  }));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('applyFastAgentEvent', () => {
  it('maps runtime events into bot state and appends timeline events', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-supervisor-applier-'));
    tempDirs.push(dir);

    const client = createDatabaseClient({
      url: `file:${join(dir, 'test.sqlite')}`,
    });
    migrateDatabase(client);

    const users = new UserRepository(client.db);
    const workspaces = new WorkspaceRepository(client.db);
    const botInstances = new BotInstanceRepository(client.db);
    const botEvents = new BotEventRepository(client.db);

    await users.create({
      email: 'zac@example.com',
      id: 'user_1',
      name: 'zac',
    });
    await workspaces.create({
      id: 'ws_1',
      name: 'Workspace',
      ownerUserId: 'user_1',
    });
    await botInstances.create({
      id: 'bot_1',
      model: 'claude-opus-4-6',
      name: 'Bot One',
      ownerUserId: 'user_1',
      provider: 'anthropic',
      desiredState: 'running',
      status: 'provisioning',
      workspaceId: 'ws_1',
    });

    const events: FastAgentJsonlEvent[] = [
      {
        agentId: 'bot_1',
        data: { channel: 'weixin' },
        message: 'started',
        pid: 120,
        timestamp: '2026-03-30T00:00:00.000Z',
        type: 'process_started',
      },
      {
        agentId: 'bot_1',
        data: {
          qrCodeUrl: 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=00000000000000000000000000000000&bot_type=3',
        },
        message: 'qr ready',
        pid: 120,
        timestamp: '2026-03-30T00:00:05.000Z',
        type: 'qr_code',
      },
      {
        agentId: 'bot_1',
        data: { accountId: 'wx_acc_1' },
        message: 'login confirmed',
        pid: 120,
        timestamp: '2026-03-30T00:00:10.000Z',
        type: 'login_confirmed',
      },
      {
        agentId: 'bot_1',
        data: { accountId: 'wx_acc_1' },
        message: 'running',
        pid: 120,
        timestamp: '2026-03-30T00:00:15.000Z',
        type: 'running',
      },
      {
        agentId: 'bot_1',
        data: { code: 'RUNTIME_ERROR' },
        message: 'runtime exploded',
        pid: 120,
        timestamp: '2026-03-30T00:00:20.000Z',
        type: 'runtime_error',
      },
      {
        agentId: 'bot_1',
        data: {},
        message: 'account invalid',
        pid: 120,
        timestamp: '2026-03-30T00:00:25.000Z',
        type: 'account_invalid',
      },
    ];

    for (const event of events) {
      await applyFastAgentEvent(
        {
          botEvents,
          botInstances,
        },
        {
          botInstanceId: 'bot_1',
          event,
        },
      );
    }

    const bot = await botInstances.findById('bot_1');
    const timeline = await botEvents.listByBotInstanceId('bot_1');

    expect(bot).toMatchObject({
      heartbeatAt: new Date('2026-03-30T00:00:25.000Z'),
      lastErrorCode: 'RUNTIME_ERROR',
      lastErrorMessage: 'runtime exploded',
      lastQrCodeUrl: 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=00000000000000000000000000000000&bot_type=3',
      processPid: 120,
      processStartedAt: new Date('2026-03-30T00:00:00.000Z'),
      restartCount: 0,
      status: 'degraded',
      weixinAccountId: 'wx_acc_1',
    });
    expect(timeline).toHaveLength(6);
    expect(timeline[0]).toMatchObject({
      botInstanceId: 'bot_1',
      type: 'account_invalid',
    });
  });

  it('records the OS-observed process start time for live process_started events', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-supervisor-process-started-at-'));
    tempDirs.push(dir);

    const client = createDatabaseClient({
      url: `file:${join(dir, 'test.sqlite')}`,
    });
    migrateDatabase(client);

    const users = new UserRepository(client.db);
    const workspaces = new WorkspaceRepository(client.db);
    const botInstances = new BotInstanceRepository(client.db);
    const botEvents = new BotEventRepository(client.db);

    await users.create({
      email: 'zac@example.com',
      id: 'user_1',
      name: 'zac',
    });
    await workspaces.create({
      id: 'ws_1',
      name: 'Workspace',
      ownerUserId: 'user_1',
    });
    await botInstances.create({
      id: 'bot_1',
      model: 'claude-opus-4-6',
      name: 'Bot One',
      ownerUserId: 'user_1',
      provider: 'anthropic',
      desiredState: 'running',
      status: 'provisioning',
      workspaceId: 'ws_1',
    });

    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60_000)'], {
      stdio: 'ignore',
    });
    tempChildren.push(child);
    await waitFor(async () => child.pid !== undefined && child.exitCode === null);

    const actualStartedAt = await getProcessStartedAt(child.pid!);
    if (!actualStartedAt) {
      throw new Error(`Unable to read process start time for pid ${child.pid}.`);
    }
    const eventTimestamp = new Date(Date.parse(actualStartedAt) + 1_500).toISOString();

    await applyFastAgentEvent(
      {
        botEvents,
        botInstances,
      },
      {
        botInstanceId: 'bot_1',
        event: {
          agentId: 'bot_1',
          data: { channel: 'weixin' },
          message: 'started',
          pid: child.pid!,
          timestamp: eventTimestamp,
          type: 'process_started',
        },
      },
    );

    const bot = await botInstances.findById('bot_1');

    expect(actualStartedAt).not.toBe(eventTimestamp);
    expect(bot).toMatchObject({
      processPid: child.pid,
      processStartedAt: new Date(actualStartedAt),
      status: 'starting',
    });
  });

  it('schedules restart attempts and eventually marks the instance as failed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-supervisor-stopped-'));
    tempDirs.push(dir);

    const client = createDatabaseClient({
      url: `file:${join(dir, 'test.sqlite')}`,
    });
    migrateDatabase(client);

    const users = new UserRepository(client.db);
    const workspaces = new WorkspaceRepository(client.db);
    const botInstances = new BotInstanceRepository(client.db);
    const botEvents = new BotEventRepository(client.db);

    await users.create({
      email: 'zac@example.com',
      id: 'user_1',
      name: 'zac',
    });
    await workspaces.create({
      id: 'ws_1',
      name: 'Workspace',
      ownerUserId: 'user_1',
    });
    await botInstances.create({
      id: 'bot_1',
      model: 'claude-opus-4-6',
      name: 'Bot One',
      ownerUserId: 'user_1',
      provider: 'anthropic',
      desiredState: 'running',
      status: 'running',
      workspaceId: 'ws_1',
    });
    await botInstances.markStarting('bot_1', {
      heartbeatAt: new Date('2026-03-30T00:00:00.000Z'),
      processPid: 120,
      processStartedAt: new Date('2026-03-30T00:00:00.000Z'),
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const event: FastAgentJsonlEvent = {
        agentId: 'bot_1',
        data: { exitCode: 1, reason: 'runtime_error' },
        message: `stopped ${attempt}`,
        pid: 120,
        timestamp: `2026-03-30T00:00:0${attempt + 1}.000Z`,
        type: 'stopped',
      };

      await applyFastAgentEvent(
        {
          botEvents,
          botInstances,
        },
        {
          botInstanceId: 'bot_1',
          event,
        },
      );
    }

    const bot = await botInstances.findById('bot_1');

    expect(bot).toMatchObject({
      lastErrorMessage: 'stopped 3',
      restartBackoffUntil: null,
      restartCount: 4,
      status: 'failed',
    });
  });

  it('keeps retrying after repeated transient Weixin fetch failures', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-supervisor-network-recovery-'));
    tempDirs.push(dir);

    const client = createDatabaseClient({
      url: `file:${join(dir, 'test.sqlite')}`,
    });
    migrateDatabase(client);

    const users = new UserRepository(client.db);
    const workspaces = new WorkspaceRepository(client.db);
    const botInstances = new BotInstanceRepository(client.db);
    const botEvents = new BotEventRepository(client.db);

    await users.create({ email: 'zac@example.com', id: 'user_1', name: 'zac' });
    await workspaces.create({ id: 'ws_1', name: 'Workspace', ownerUserId: 'user_1' });
    await botInstances.create({
      desiredState: 'running',
      id: 'bot_1',
      model: 'claude-opus-4-6',
      name: 'Bot One',
      ownerUserId: 'user_1',
      provider: 'anthropic',
      status: 'running',
      workspaceId: 'ws_1',
    });
    await botInstances.markStarting('bot_1', {
      heartbeatAt: new Date('2026-03-30T00:00:00.000Z'),
      processPid: 120,
      processStartedAt: new Date('2026-03-30T00:00:00.000Z'),
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const second = attempt * 2 + 1;

      await applyFastAgentEvent({ botEvents, botInstances }, {
        botInstanceId: 'bot_1',
        event: {
          agentId: 'bot_1',
          data: { error: 'fetch failed' },
          message: 'IM runtime failed',
          pid: 120,
          timestamp: `2026-03-30T00:00:0${second}.000Z`,
          type: 'runtime_error',
        },
      });
      await applyFastAgentEvent({ botEvents, botInstances }, {
        botInstanceId: 'bot_1',
        event: {
          agentId: 'bot_1',
          data: { exitCode: 1, reason: 'runtime_error' },
          message: 'IM runtime stopped',
          pid: 120,
          timestamp: `2026-03-30T00:00:0${second + 1}.000Z`,
          type: 'stopped',
        },
      });
    }

    expect(await botInstances.findById('bot_1')).toMatchObject({
      lastErrorMessage: 'fetch failed',
      restartBackoffUntil: new Date('2026-03-30T00:01:08.000Z'),
      restartCount: 3,
      status: 'stopped',
    });
  });

  it('rejects untrusted qr urls without persisting them as the last qr code', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-supervisor-bad-qr-'));
    tempDirs.push(dir);

    const client = createDatabaseClient({
      url: `file:${join(dir, 'test.sqlite')}`,
    });
    migrateDatabase(client);

    const users = new UserRepository(client.db);
    const workspaces = new WorkspaceRepository(client.db);
    const botInstances = new BotInstanceRepository(client.db);
    const botEvents = new BotEventRepository(client.db);

    await users.create({
      email: 'zac@example.com',
      id: 'user_1',
      name: 'zac',
    });
    await workspaces.create({
      id: 'ws_1',
      name: 'Workspace',
      ownerUserId: 'user_1',
    });
    await botInstances.create({
      id: 'bot_1',
      model: 'claude-opus-4-6',
      name: 'Bot One',
      ownerUserId: 'user_1',
      provider: 'anthropic',
      desiredState: 'running',
      status: 'starting',
      workspaceId: 'ws_1',
    });

    await applyFastAgentEvent(
      {
        botEvents,
        botInstances,
      },
      {
        botInstanceId: 'bot_1',
        event: {
          agentId: 'bot_1',
          data: {
            qrCodeUrl: 'javascript:alert(1)',
          },
          message: 'qr ready',
          pid: 120,
          timestamp: '2026-03-30T00:00:05.000Z',
          type: 'qr_code',
        },
      },
    );

    const bot = await botInstances.findById('bot_1');
    const timeline = await botEvents.listByBotInstanceId('bot_1');

    expect(bot).toMatchObject({
      lastErrorCode: 'INVALID_QR_URL',
      lastQrCodeId: null,
      lastQrCodeUrl: null,
    });
    expect(timeline[0]).toMatchObject({
      type: 'qr_code',
    });
  });

  it('preserves structured runtime_error details from the saved real sample', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-supervisor-real-sample-'));
    tempDirs.push(dir);

    const client = createDatabaseClient({
      url: `file:${join(dir, 'test.sqlite')}`,
    });
    migrateDatabase(client);

    const users = new UserRepository(client.db);
    const workspaces = new WorkspaceRepository(client.db);
    const botInstances = new BotInstanceRepository(client.db);
    const botEvents = new BotEventRepository(client.db);

    await users.create({
      email: 'zac@example.com',
      id: 'user_1',
      name: 'zac',
    });
    await workspaces.create({
      id: 'ws_1',
      name: 'Workspace',
      ownerUserId: 'user_1',
    });
    await botInstances.create({
      id: 'bot_contract_smoke',
      model: 'claude-opus-4-6',
      name: 'Bot One',
      ownerUserId: 'user_1',
      provider: 'anthropic',
      desiredState: 'running',
      status: 'provisioning',
      workspaceId: 'ws_1',
    });

    const events = parseFastAgentJsonlOutput(await readFile(getFixturePath('fastagent-cli-runtime-error.sample.jsonl'), 'utf8'));

    for (const event of events) {
      await applyFastAgentEvent(
        {
          botEvents,
          botInstances,
        },
        {
          botInstanceId: 'bot_contract_smoke',
          event,
        },
      );
    }

    const bot = await botInstances.findById('bot_contract_smoke');

    expect(bot).toMatchObject({
      lastErrorCode: 'RUNTIME_ERROR',
      lastErrorMessage: 'unable to determine transport target for "pino-pretty"',
      restartCount: 1,
      status: 'stopped',
    });
  });

  it('records account state from the restored running sample', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-supervisor-restored-running-'));
    tempDirs.push(dir);

    const client = createDatabaseClient({
      url: `file:${join(dir, 'test.sqlite')}`,
    });
    migrateDatabase(client);

    const users = new UserRepository(client.db);
    const workspaces = new WorkspaceRepository(client.db);
    const botInstances = new BotInstanceRepository(client.db);
    const botEvents = new BotEventRepository(client.db);

    await users.create({
      email: 'zac@example.com',
      id: 'user_1',
      name: 'zac',
    });
    await workspaces.create({
      id: 'ws_1',
      name: 'Workspace',
      ownerUserId: 'user_1',
    });
    await botInstances.create({
      id: 'bot_contract_smoke',
      model: 'claude-opus-4-6',
      name: 'Bot One',
      ownerUserId: 'user_1',
      provider: 'anthropic',
      desiredState: 'running',
      status: 'stopped',
      workspaceId: 'ws_1',
    });
    await botInstances.scheduleRestart('bot_contract_smoke', {
      observedAt: new Date('2026-03-30T10:18:00.000Z'),
      restartBackoffUntil: new Date('2026-03-30T10:18:10.000Z'),
      restartCount: 2,
    });
    await botInstances.recordRuntimeError('bot_contract_smoke', {
      errorCode: 'RUNTIME_ERROR',
      errorMessage: 'Previous crash.',
      observedAt: new Date('2026-03-30T10:18:00.000Z'),
    });

    const events = parseFastAgentJsonlOutput(
      await readFile(getFixturePath('fastagent-cli-restored-running.sample.jsonl'), 'utf8'),
    );

    for (const event of events.slice(0, 2)) {
      await applyFastAgentEvent(
        {
          botEvents,
          botInstances,
        },
        {
          botInstanceId: 'bot_contract_smoke',
          event,
        },
      );
    }

    const bot = await botInstances.findById('bot_contract_smoke');

    expect(bot).toMatchObject({
      heartbeatAt: new Date('2026-03-30T10:18:19.068Z'),
      lastErrorCode: null,
      lastErrorMessage: null,
      processPid: 84721,
      processStartedAt: new Date('2026-03-30T10:18:18.753Z'),
      restartBackoffUntil: null,
      restartCount: 0,
      status: 'running',
      weixinAccountId: '0123456789ab@im.bot',
    });
  });

  it('keeps the real qr sample visible and honors graceful stop once desired state flips to stopped', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-supervisor-fresh-qr-'));
    tempDirs.push(dir);

    const client = createDatabaseClient({
      url: `file:${join(dir, 'test.sqlite')}`,
    });
    migrateDatabase(client);

    const users = new UserRepository(client.db);
    const workspaces = new WorkspaceRepository(client.db);
    const botInstances = new BotInstanceRepository(client.db);
    const botEvents = new BotEventRepository(client.db);

    await users.create({
      email: 'zac@example.com',
      id: 'user_1',
      name: 'zac',
    });
    await workspaces.create({
      id: 'ws_1',
      name: 'Workspace',
      ownerUserId: 'user_1',
    });
    await botInstances.create({
      id: 'bot_fresh_contract',
      model: 'claude-opus-4-6',
      name: 'Bot One',
      ownerUserId: 'user_1',
      provider: 'anthropic',
      desiredState: 'running',
      status: 'provisioning',
      workspaceId: 'ws_1',
    });

    const events = parseFastAgentJsonlOutput(
      await readFile(getFixturePath('fastagent-cli-fresh-qr.sample.jsonl'), 'utf8'),
    );

    for (const event of events.slice(0, 2)) {
      await applyFastAgentEvent(
        {
          botEvents,
          botInstances,
        },
        {
          botInstanceId: 'bot_fresh_contract',
          event,
        },
      );
    }

    await botInstances.setDesiredState('bot_fresh_contract', 'stopped');

    for (const event of events.slice(2)) {
      await applyFastAgentEvent(
        {
          botEvents,
          botInstances,
        },
        {
          botInstanceId: 'bot_fresh_contract',
          event,
        },
      );
    }

    const bot = await botInstances.findById('bot_fresh_contract');

    expect(bot).toMatchObject({
      heartbeatAt: new Date('2026-03-30T10:19:19.331Z'),
      lastQrCodeUrl: 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=00000000000000000000000000000000&bot_type=3',
      processPid: null,
      processStartedAt: null,
      status: 'stopped',
    });
  });

  it('maps the real login_confirmed sample into qr, account, and running state', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-supervisor-login-confirmed-'));
    tempDirs.push(dir);

    const client = createDatabaseClient({
      url: `file:${join(dir, 'test.sqlite')}`,
    });
    migrateDatabase(client);

    const users = new UserRepository(client.db);
    const workspaces = new WorkspaceRepository(client.db);
    const botInstances = new BotInstanceRepository(client.db);
    const botEvents = new BotEventRepository(client.db);

    await users.create({
      email: 'zac@example.com',
      id: 'user_1',
      name: 'zac',
    });
    await workspaces.create({
      id: 'ws_1',
      name: 'Workspace',
      ownerUserId: 'user_1',
    });
    await botInstances.create({
      id: 'bot_login_sample',
      model: 'claude-opus-4-6',
      name: 'Bot One',
      ownerUserId: 'user_1',
      provider: 'anthropic',
      desiredState: 'running',
      status: 'provisioning',
      workspaceId: 'ws_1',
    });

    const events = parseFastAgentJsonlOutput(
      await readFile(getFixturePath('fastagent-cli-login-confirmed.sample.jsonl'), 'utf8'),
    );

    for (const event of events) {
      await applyFastAgentEvent(
        {
          botEvents,
          botInstances,
        },
        {
          botInstanceId: 'bot_login_sample',
          event,
        },
      );
    }

    const bot = await botInstances.findById('bot_login_sample');
    const timeline = await botEvents.listByBotInstanceId('bot_login_sample');

    expect(bot).toMatchObject({
      heartbeatAt: new Date('2026-03-30T10:44:41.128Z'),
      lastQrCodeUrl: 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=00000000000000000000000000000000&bot_type=3',
      processPid: 15216,
      processStartedAt: new Date('2026-03-30T10:44:06.794Z'),
      restartCount: 0,
      status: 'running',
      weixinAccountId: '0123456789ab@im.bot',
    });
    expect(timeline).toHaveLength(4);
    expect(timeline[0]).toMatchObject({
      type: 'running',
    });
  });

  it('ignores stale qr_code events from an older pid after the current runtime is running', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-supervisor-stale-qr-'));
    tempDirs.push(dir);

    const client = createDatabaseClient({
      url: `file:${join(dir, 'test.sqlite')}`,
    });
    migrateDatabase(client);

    const users = new UserRepository(client.db);
    const workspaces = new WorkspaceRepository(client.db);
    const botInstances = new BotInstanceRepository(client.db);
    const botEvents = new BotEventRepository(client.db);

    await users.create({
      email: 'zac@example.com',
      id: 'user_1',
      name: 'zac',
    });
    await workspaces.create({
      id: 'ws_1',
      name: 'Workspace',
      ownerUserId: 'user_1',
    });
    await botInstances.create({
      id: 'bot_1',
      model: 'claude-opus-4-6',
      name: 'Bot One',
      ownerUserId: 'user_1',
      provider: 'anthropic',
      desiredState: 'running',
      status: 'provisioning',
      workspaceId: 'ws_1',
    });

    const currentRuntimeEvents: FastAgentJsonlEvent[] = [
      {
        agentId: 'bot_1',
        data: { channel: 'weixin' },
        message: 'started',
        pid: 120,
        timestamp: '2026-03-30T00:00:00.000Z',
        type: 'process_started',
      },
      {
        agentId: 'bot_1',
        data: {
          qrCodeUrl: 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=00000000000000000000000000000000&bot_type=3',
        },
        message: 'qr ready',
        pid: 120,
        timestamp: '2026-03-30T00:00:05.000Z',
        type: 'qr_code',
      },
      {
        agentId: 'bot_1',
        data: { accountId: 'wx_acc_1' },
        message: 'login confirmed',
        pid: 120,
        timestamp: '2026-03-30T00:00:10.000Z',
        type: 'login_confirmed',
      },
      {
        agentId: 'bot_1',
        data: { accountId: 'wx_acc_1' },
        message: 'running',
        pid: 120,
        timestamp: '2026-03-30T00:00:15.000Z',
        type: 'running',
      },
    ];

    for (const event of currentRuntimeEvents) {
      await applyFastAgentEvent(
        {
          botEvents,
          botInstances,
        },
        {
          botInstanceId: 'bot_1',
          event,
        },
      );
    }

    await applyFastAgentEvent(
      {
        botEvents,
        botInstances,
      },
      {
        botInstanceId: 'bot_1',
        event: {
          agentId: 'bot_1',
          data: {
            qrCodeUrl: 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=00000000000000000000000000000000&bot_type=3',
          },
          message: 'stale qr ready',
          pid: 119,
          timestamp: '2026-03-30T00:00:20.000Z',
          type: 'qr_code',
        },
      },
    );

    const bot = await botInstances.findById('bot_1');
    const timeline = await botEvents.listByBotInstanceId('bot_1');

    expect(bot).toMatchObject({
      lastQrCodeUrl: 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=00000000000000000000000000000000&bot_type=3',
      processPid: 120,
      status: 'running',
      weixinAccountId: 'wx_acc_1',
    });
    expect(timeline).toHaveLength(4);
    expect(timeline.map((event) => event.type)).toEqual([
      'running',
      'login_confirmed',
      'qr_code',
      'process_started',
    ]);
  });

  it('keeps the first qr from the same runtime until a reissue is requested', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-supervisor-qr-ttl-'));
    tempDirs.push(dir);

    const client = createDatabaseClient({
      url: `file:${join(dir, 'test.sqlite')}`,
    });
    migrateDatabase(client);

    const users = new UserRepository(client.db);
    const workspaces = new WorkspaceRepository(client.db);
    const botInstances = new BotInstanceRepository(client.db);
    const botEvents = new BotEventRepository(client.db);

    await users.create({ email: 'zac@example.com', id: 'user_1', name: 'zac' });
    await workspaces.create({ id: 'ws_1', name: 'Workspace', ownerUserId: 'user_1' });
    await botInstances.create({
      desiredState: 'running',
      id: 'bot_1',
      model: 'claude-opus-4-6',
      name: 'Bot One',
      ownerUserId: 'user_1',
      provider: 'anthropic',
      status: 'provisioning',
      workspaceId: 'ws_1',
    });

    const apply = (event: FastAgentJsonlEvent) => applyFastAgentEvent(
      { botEvents, botInstances },
      { botInstanceId: 'bot_1', event },
    );

    const firstQrUrl = 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=00000000000000000000000000000000&bot_type=3';
    const repeatedQrUrl = 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=00000000000000000000000000000000&bot_type=3';

    await apply({
      agentId: 'bot_1',
      data: { channel: 'weixin' },
      message: 'started',
      pid: 120,
      timestamp: '2026-03-30T00:00:00.000Z',
      type: 'process_started',
    });
    await apply({
      agentId: 'bot_1',
      data: { qrCodeUrl: firstQrUrl },
      message: 'qr ready',
      pid: 120,
      timestamp: '2026-03-30T00:00:05.000Z',
      type: 'qr_code',
    });
    await apply({
      agentId: 'bot_1',
      data: { qrCodeUrl: repeatedQrUrl },
      message: 'qr refreshed',
      pid: 120,
      timestamp: '2026-03-30T00:02:00.000Z',
      type: 'qr_code',
    });
    await apply({
      agentId: 'bot_1',
      data: { qrCodeUrl: repeatedQrUrl },
      message: 'qr refreshed after ttl',
      pid: 120,
      timestamp: '2026-03-30T00:12:00.000Z',
      type: 'qr_code',
    });

    const beforeReissue = await botInstances.findById('bot_1');

    expect(beforeReissue).toMatchObject({
      lastQrCodeUrl: firstQrUrl,
      qrCodeIssuedAt: new Date('2026-03-30T00:00:05.000Z'),
    });

    await botInstances.requestQrReissue('bot_1', new Date('2026-03-30T00:12:30.000Z'));
    await apply({
      agentId: 'bot_1',
      data: { qrCodeUrl: repeatedQrUrl },
      message: 'qr after reissue',
      pid: 120,
      timestamp: '2026-03-30T00:12:35.000Z',
      type: 'qr_code',
    });

    const bot = await botInstances.findById('bot_1');
    const timeline = await botEvents.listByBotInstanceId('bot_1');

    expect(bot).toMatchObject({
      lastQrCodeUrl: repeatedQrUrl,
      qrCodeIssuedAt: new Date('2026-03-30T00:12:35.000Z'),
    });
    expect(timeline.map((event) => event.type)).toEqual([
      'qr_code',
      'qr_code',
      'process_started',
    ]);
  });

  it('invalidates the stored qr when a new process starts and accepts its fresh qr', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-supervisor-restart-qr-'));
    tempDirs.push(dir);

    const client = createDatabaseClient({
      url: `file:${join(dir, 'test.sqlite')}`,
    });
    migrateDatabase(client);

    const users = new UserRepository(client.db);
    const workspaces = new WorkspaceRepository(client.db);
    const botInstances = new BotInstanceRepository(client.db);
    const botEvents = new BotEventRepository(client.db);

    await users.create({ email: 'zac@example.com', id: 'user_1', name: 'zac' });
    await workspaces.create({ id: 'ws_1', name: 'Workspace', ownerUserId: 'user_1' });
    await botInstances.create({
      desiredState: 'running',
      id: 'bot_1',
      model: 'claude-opus-4-6',
      name: 'Bot One',
      ownerUserId: 'user_1',
      provider: 'anthropic',
      status: 'provisioning',
      workspaceId: 'ws_1',
    });

    const apply = (event: FastAgentJsonlEvent) => applyFastAgentEvent(
      { botEvents, botInstances },
      { botInstanceId: 'bot_1', event },
    );

    const oldQrUrl = 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=00000000000000000000000000000000&bot_type=3';
    const freshQrUrl = 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=00000000000000000000000000000000&bot_type=3';

    await apply({
      agentId: 'bot_1',
      data: { channel: 'weixin' },
      message: 'started',
      pid: 120,
      timestamp: '2026-03-30T00:00:00.000Z',
      type: 'process_started',
    });
    await apply({
      agentId: 'bot_1',
      data: { qrCodeUrl: oldQrUrl },
      message: 'qr ready',
      pid: 120,
      timestamp: '2026-03-30T00:00:05.000Z',
      type: 'qr_code',
    });
    await apply({
      agentId: 'bot_1',
      data: { channel: 'weixin' },
      message: 'started after restart',
      pid: 121,
      timestamp: '2026-03-30T00:10:00.000Z',
      type: 'process_started',
    });
    await apply({
      agentId: 'bot_1',
      data: { qrCodeUrl: freshQrUrl },
      message: 'fresh qr ready',
      pid: 121,
      timestamp: '2026-03-30T00:10:05.000Z',
      type: 'qr_code',
    });

    const bot = await botInstances.findById('bot_1');
    const timeline = await botEvents.listByBotInstanceId('bot_1');

    expect(bot).toMatchObject({
      lastQrCodeUrl: freshQrUrl,
      processPid: 121,
      qrCodeIssuedAt: new Date('2026-03-30T00:10:05.000Z'),
    });
    expect(timeline).toHaveLength(4);
  });
});

function getFixturePath(fixtureName: string) {
  return fileURLToPath(
    new URL(`../../../../../tests/fixtures/${fixtureName}`, import.meta.url),
  );
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number = 5_000) {
  const start = Date.now();

  while (Date.now() - start <= timeoutMs) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }

  throw new Error('Timed out waiting for condition.');
}
