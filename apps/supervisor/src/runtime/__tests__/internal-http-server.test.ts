import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BroadcastError } from '../broadcast-service';
import {
  createInternalHttpServer,
  type InternalHttpServerDependencies,
} from '../internal-http-server';

describe('internal HTTP server web-chat bridge', () => {
  const servers: Array<{ close: () => void }> = [];

  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.close();
    }
    vi.restoreAllMocks();
  });

  it('rejects requests without a valid bearer token', async () => {
    const { url } = await startServer({
      assertCanRunExternalTurn: vi.fn(),
      runExternalTurn: vi.fn(),
    });

    const noAuth = await fetch(`${url}/internal/web-chat/turns`, {
      body: JSON.stringify({ botInstanceId: 'bot_1', requestId: 'r1', text: 'hi' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(noAuth.status).toBe(401);
    await expect(noAuth.json()).resolves.toMatchObject({ code: 'UNAUTHORIZED' });

    const wrongAuth = await fetch(`${url}/internal/web-chat/turns`, {
      body: JSON.stringify({ botInstanceId: 'bot_1', requestId: 'r1', text: 'hi' }),
      headers: {
        authorization: 'Bearer wrong',
        'content-type': 'application/json',
      },
      method: 'POST',
    });
    expect(wrongAuth.status).toBe(401);
  });

  it('rejects malformed request bodies', async () => {
    const { url } = await startServer({
      assertCanRunExternalTurn: vi.fn(),
      runExternalTurn: vi.fn(),
    });

    const response = await fetch(`${url}/internal/web-chat/turns`, {
      body: JSON.stringify({ requestId: 'r1' }),
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      method: 'POST',
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('maps a stopped Bot and an in-flight turn to HTTP 409', async () => {
    const notRunning = await startServer({
      assertCanRunExternalTurn: vi.fn(() => {
        throw new Error('Bot process is not running.');
      }),
      runExternalTurn: vi.fn(),
    });
    const notRunningResponse = await postTurn(notRunning.url);
    expect(notRunningResponse.status).toBe(409);
    await expect(notRunningResponse.json()).resolves.toMatchObject({ code: 'BOT_NOT_RUNNING' });

    const inFlight = await startServer({
      assertCanRunExternalTurn: vi.fn(() => {
        throw new Error('External turn is already in progress.');
      }),
      runExternalTurn: vi.fn(),
    });
    const inFlightResponse = await postTurn(inFlight.url);
    expect(inFlightResponse.status).toBe(409);
    await expect(inFlightResponse.json()).resolves.toMatchObject({ code: 'TURN_IN_PROGRESS' });
  });

  it('streams normalized SSE frames for text, tool calls, and the final reply', async () => {
    const runExternalTurn = vi.fn(async (
      _botInstanceId: string,
      _requestId: string,
      _text: string,
      options: { onEvent?: (event: unknown) => void },
    ) => {
      options.onEvent?.({ type: 'message_delta', data: { text: '北京天气' } });
      options.onEvent?.({
        type: 'tool_call',
        data: { id: 'call_1', name: 'weather', input: { city: '北京' } },
      });
      options.onEvent?.({
        type: 'tool_result',
        data: { toolUseId: 'call_1', structuredContent: { temperature: 32 } },
      });
      return '北京天气：32°C';
    });
    const { url } = await startServer({
      assertCanRunExternalTurn: vi.fn(),
      runExternalTurn,
    });

    const response = await postTurn(url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const body = await readStream(response);

    expect(body).toContain('event: turn_start');
    expect(body).toContain('event: text_delta\ndata: {"delta":"北京天气"}');
    expect(body).toContain('event: tool_call\ndata: {"toolCallId":"call_1","toolName":"weather","input":{"city":"北京"}}');
    expect(body).toContain('event: tool_result\ndata: {"toolCallId":"call_1","output":{"temperature":32}}');
    expect(body).toContain('event: message_end\ndata: {"text":"北京天气：32°C"}');
    expect(runExternalTurn).toHaveBeenCalledWith(
      'bot_1',
      'r1',
      'hello',
      expect.objectContaining({ timeoutMs: 5 * 60_000 }),
    );
  });

  it('emits an error frame when the external turn fails at runtime', async () => {
    const runExternalTurn = vi.fn(async () => {
      throw new Error('model unavailable');
    });
    const { url } = await startServer({
      assertCanRunExternalTurn: vi.fn(),
      runExternalTurn,
    });

    const response = await postTurn(url);
    expect(response.status).toBe(200);
    const body = await readStream(response);
    expect(body).toContain('event: error\ndata: {"message":"model unavailable"}');
  });

  it('requires bearer auth on the broadcast and group task routes', async () => {
    const { url } = await startServer({});

    const broadcast = await fetch(`${url}/internal/broadcast`, {
      body: JSON.stringify({ botInstanceId: 'bot_1', scope: 'all', text: 'hi' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(broadcast.status).toBe(401);

    const listTasks = await fetch(`${url}/internal/me/tasks?botInstanceId=bot_1`);
    expect(listTasks.status).toBe(401);

    const submitTask = await fetch(`${url}/internal/me/tasks/task_1/submit`, {
      body: JSON.stringify({ botInstanceId: 'bot_1', summary: 'done' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(submitTask.status).toBe(401);
  });

  it('maps broadcast success and typed errors to the documented status codes', async () => {
    const successBroadcast = vi.fn(async () => ({
      accepted: true,
      deliveryCount: 2,
      deliveryIds: ['d1', 'd2'],
    }));
    const { url } = await startServer({
      broadcastService: { sendBroadcast: successBroadcast },
    });

    const success = await fetch(`${url}/internal/broadcast`, {
      body: JSON.stringify({
        botInstanceId: 'bot_1',
        scope: 'selected',
        targetBotInstanceIds: ['bot_2', 'bot_3'],
        text: 'hello',
      }),
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      method: 'POST',
    });
    expect(success.status).toBe(200);
    await expect(success.json()).resolves.toEqual({
      accepted: true,
      deliveryCount: 2,
      deliveryIds: ['d1', 'd2'],
    });
    expect(successBroadcast).toHaveBeenCalledWith({
      botInstanceId: 'bot_1',
      scope: 'selected',
      targetBotInstanceIds: ['bot_2', 'bot_3'],
      text: 'hello',
    });

    const forbidden = await startServer({
      broadcastService: {
        sendBroadcast: vi.fn(async () => {
          throw new BroadcastError('FORBIDDEN', 'forbidden');
        }),
      },
    });
    const forbiddenResponse = await postBroadcast(forbidden.url);
    expect(forbiddenResponse.status).toBe(403);
    await expect(forbiddenResponse.json()).resolves.toMatchObject({ code: 'FORBIDDEN' });

    const rateLimited = await startServer({
      broadcastService: {
        sendBroadcast: vi.fn(async () => {
          throw new BroadcastError('RATE_LIMITED', 'rate limited');
        }),
      },
    });
    const rateLimitedResponse = await postBroadcast(rateLimited.url);
    expect(rateLimitedResponse.status).toBe(429);
    await expect(rateLimitedResponse.json()).resolves.toMatchObject({ code: 'RATE_LIMITED' });

    const invalidText = await startServer({
      broadcastService: {
        sendBroadcast: vi.fn(async () => {
          throw new BroadcastError('INVALID_TEXT', 'invalid text');
        }),
      },
    });
    const invalidTextResponse = await postBroadcast(invalidText.url);
    expect(invalidTextResponse.status).toBe(400);
    await expect(invalidTextResponse.json()).resolves.toMatchObject({ code: 'INVALID_TEXT' });
  });

  it('lists assigned tasks with group and assigner names', async () => {
    const task = {
      id: 'task_1',
      groupId: 'group_1',
      assignerEmployeeId: 'leader',
      assigneeEmployeeId: 'worker',
      title: '周报',
      description: '',
      acceptanceCriteria: '',
      status: 'pending' as const,
      dueAt: null,
      submittedAt: null,
      submittedSummary: null,
      submittedEvidenceJson: null,
      acceptedAt: null,
      feedback: null,
      createdAt: new Date('2026-08-24T00:00:00.000Z'),
      updatedAt: new Date('2026-08-24T00:00:00.000Z'),
    };
    const employeeDirectory = {
      findClaimedByBotInstanceId: vi.fn(async () => ({
        id: 'worker',
        legalName: 'Worker',
        companyEmail: null,
        nickname: 'Worker Nick',
        normalizedLegalName: 'worker',
        normalizedNickname: 'worker nick',
        enabled: true,
        claimedBotInstanceId: 'bot_1',
        claimedAt: new Date(),
        claimedByUserId: 'user_worker',
        claimedViaInviteId: 'invite',
        groupId: null,
        reservationInviteId: null,
        reservationToken: null,
        reservedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      findById: vi.fn(async () => ({
        id: 'leader',
        legalName: 'Leader',
        companyEmail: null,
        nickname: 'Leader Nick',
        normalizedLegalName: 'leader',
        normalizedNickname: 'leader nick',
        enabled: true,
        claimedAt: null,
        claimedBotInstanceId: null,
        claimedByUserId: null,
        claimedViaInviteId: null,
        groupId: null,
        reservationInviteId: null,
        reservationToken: null,
        reservedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    };
    const employeeGroups = {
      findById: vi.fn(async () => ({
        id: 'group_1',
        name: '工程组',
        leaderEmployeeId: 'leader',
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    };
    const groupTaskService = {
      findById: vi.fn(),
      listByAssignee: vi.fn(async () => [task]),
      markSubmitted: vi.fn(),
    };
    const { url } = await startServer({
      employeeDirectory,
      employeeGroups,
      groupTaskService,
    });

    const response = await fetch(`${url}/internal/me/tasks?botInstanceId=bot_1`, {
      headers: { authorization: 'Bearer test-token' },
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { tasks: Array<Record<string, unknown>> };
    expect(body.tasks[0]).toMatchObject({
      id: 'task_1',
      groupName: '工程组',
      assignerName: 'Leader Nick',
    });
    expect(groupTaskService.listByAssignee).toHaveBeenCalledWith('worker');
  });

  it('submits a task for the assignee and maps 404/403 task failures', async () => {
    const submittedTask = {
      id: 'task_1',
      groupId: 'group_1',
      assignerEmployeeId: 'leader',
      assigneeEmployeeId: 'worker',
      title: '周报',
      description: '',
      acceptanceCriteria: '',
      status: 'submitted' as const,
      dueAt: null,
      submittedAt: '2026-08-24T00:00:00.000Z',
      submittedSummary: '已完成',
      submittedEvidenceJson: '["/tmp/report.pdf"]',
      acceptedAt: null,
      feedback: null,
      createdAt: '2026-08-24T00:00:00.000Z',
      updatedAt: '2026-08-24T00:00:00.000Z',
    };
    const employeeDirectory = {
      findClaimedByBotInstanceId: vi.fn(async () => ({
        id: 'worker',
        legalName: 'Worker',
        companyEmail: null,
        nickname: null,
        normalizedLegalName: 'worker',
        normalizedNickname: 'worker',
        enabled: true,
        claimedBotInstanceId: 'bot_1',
        claimedAt: new Date(),
        claimedByUserId: 'user_worker',
        claimedViaInviteId: 'invite',
        groupId: null,
        reservationInviteId: null,
        reservationToken: null,
        reservedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      findById: vi.fn(),
    };
    const groupTaskService = {
      findById: vi.fn(async () => ({
        ...submittedTask,
        status: 'pending' as const,
        submittedAt: null,
        submittedSummary: null,
        submittedEvidenceJson: null,
      })),
      listByAssignee: vi.fn(),
      markSubmitted: vi.fn(async () => submittedTask),
    };
    const { url } = await startServer({
      employeeDirectory,
      groupTaskService,
    });

    const success = await fetch(`${url}/internal/me/tasks/task_1/submit`, {
      body: JSON.stringify({
        botInstanceId: 'bot_1',
        evidencePaths: ['/tmp/report.pdf'],
        summary: ' 已完成 ',
      }),
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      method: 'POST',
    });
    expect(success.status).toBe(200);
    await expect(success.json()).resolves.toEqual({ task: submittedTask });
    expect(groupTaskService.markSubmitted).toHaveBeenCalledWith('task_1', {
      evidencePaths: ['/tmp/report.pdf'],
      summary: '已完成',
    });

    const missingEmployee = await startServer({
      employeeDirectory: {
        findClaimedByBotInstanceId: vi.fn(async () => null),
        findById: vi.fn(),
      },
      employeeGroups: {
        findById: vi.fn(),
      },
      groupTaskService,
    });
    const missingEmployeeResponse = await fetch(
      `${missingEmployee.url}/internal/me/tasks?botInstanceId=bot_1`,
      { headers: { authorization: 'Bearer test-token' } },
    );
    expect(missingEmployeeResponse.status).toBe(404);

    const missingTask = await startServer({
      employeeDirectory,
      groupTaskService: {
        ...groupTaskService,
        findById: vi.fn(async () => null),
      },
    });
    const missingTaskResponse = await fetch(
      `${missingTask.url}/internal/me/tasks/missing/submit`,
      {
        body: JSON.stringify({ botInstanceId: 'bot_1', summary: 'done' }),
        headers: {
          authorization: 'Bearer test-token',
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    );
    expect(missingTaskResponse.status).toBe(404);

    const wrongAssignee = await startServer({
      employeeDirectory: {
        findClaimedByBotInstanceId: vi.fn(async () => ({
          id: 'other_worker',
          legalName: 'Other',
          companyEmail: null,
          nickname: null,
          normalizedLegalName: 'other',
          normalizedNickname: 'other',
          enabled: true,
          claimedBotInstanceId: 'bot_2',
          claimedAt: new Date(),
          claimedByUserId: 'user_other',
          claimedViaInviteId: 'invite',
          groupId: null,
          reservationInviteId: null,
          reservationToken: null,
          reservedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        findById: vi.fn(),
      },
      groupTaskService,
    });
    const wrongAssigneeResponse = await fetch(
      `${wrongAssignee.url}/internal/me/tasks/task_1/submit`,
      {
        body: JSON.stringify({ botInstanceId: 'bot_2', summary: 'done' }),
        headers: {
          authorization: 'Bearer test-token',
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    );
    expect(wrongAssigneeResponse.status).toBe(403);
    await expect(wrongAssigneeResponse.json()).resolves.toMatchObject({ code: 'FORBIDDEN' });
  });

  async function startServer(
    overrides: {
      assertCanRunExternalTurn?: ReturnType<typeof vi.fn>;
      broadcastService?: unknown;
      employeeDirectory?: unknown;
      employeeGroups?: unknown;
      groupTaskService?: unknown;
      runExternalTurn?: ReturnType<typeof vi.fn>;
    },
  ) {
    const {
      assertCanRunExternalTurn = vi.fn(),
      runExternalTurn = vi.fn(),
      ...rest
    } = overrides;
    const server = createInternalHttpServer({
      apiToken: 'test-token',
      port: 0,
      processManager: {
        assertCanRunExternalTurn,
        runExternalTurn,
      } as never,
      ...rest,
    } as unknown as InternalHttpServerDependencies);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    return { server, url: `http://127.0.0.1:${address.port}` };
  }

  async function postTurn(url: string) {
    return fetch(`${url}/internal/web-chat/turns`, {
      body: JSON.stringify({ botInstanceId: 'bot_1', requestId: 'r1', text: 'hello' }),
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      method: 'POST',
    });
  }

  async function postBroadcast(url: string) {
    return fetch(`${url}/internal/broadcast`, {
      body: JSON.stringify({ botInstanceId: 'bot_1', scope: 'all', text: 'hello' }),
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      method: 'POST',
    });
  }
});

async function readStream(response: Response): Promise<string> {
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const chunks: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(new TextDecoder().decode(value));
  }
  return chunks.join('');
}
