import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type {
  EmployeeDirectoryRepository,
  EmployeeGroupRepository,
  GroupTaskRepository,
} from '@weiling-ai/db';
import {
  BroadcastError,
  type BroadcastScope,
  type BroadcastService,
  type SendBroadcastInput,
} from './broadcast-service';
import type { ProcessManager } from './process-manager';

const MAX_REQUEST_BODY_BYTES = 128 * 1024;
const KEEPALIVE_INTERVAL_MS = 10_000;
const EXTERNAL_TURN_TIMEOUT_MS = 5 * 60_000;

export interface InternalHttpServerDependencies {
  apiToken: string;
  broadcast?: Pick<BroadcastService, 'sendBroadcast'>;
  broadcastService?: Pick<BroadcastService, 'sendBroadcast'>;
  employeeDirectory?: Pick<
    EmployeeDirectoryRepository,
    'findById' | 'findClaimedByBotInstanceId'
  >;
  employeeGroups?: Pick<EmployeeGroupRepository, 'findById'>;
  groupTaskService?: Pick<
    GroupTaskRepository,
    'findById' | 'listByAssignee' | 'markSubmitted'
  >;
  port: number;
  processManager: Pick<ProcessManager, 'assertCanRunExternalTurn' | 'runExternalTurn'>;
}

interface ExternalTurnRequest {
  botInstanceId: string;
  requestId: string;
  text: string;
}

interface SubmitTaskRequest {
  botInstanceId: string;
  evidencePaths: string[];
  summary: string;
}

export function createInternalHttpServer(
  dependencies: InternalHttpServerDependencies,
): Server {
  const server = createServer((request, response) => {
    void handleRequest(dependencies, request, response).catch((error: unknown) => {
      console.error('Internal HTTP server request failed.');
      console.error(error);
      if (!response.headersSent) {
        writeJson(response, 500, {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Internal server error.',
        });
      }
    });
  });

  server.on('clientError', (_error, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  return server;
}

async function handleRequest(
  dependencies: InternalHttpServerDependencies,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (!isAuthorized(request, dependencies.apiToken)) {
    writeJson(response, 401, { code: 'UNAUTHORIZED', message: 'Unauthorized.' });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/internal/broadcast') {
    await handleBroadcast(dependencies, request, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/internal/me/tasks') {
    await handleListTasks(dependencies, request, response, url);
    return;
  }

  if (request.method === 'POST') {
    const taskId = parseSubmitTaskPath(url.pathname);
    if (taskId !== null) {
      await handleSubmitTask(dependencies, request, response, taskId);
      return;
    }
  }

  if (request.method !== 'POST' || url.pathname !== '/internal/web-chat/turns') {
    writeJson(response, 404, { code: 'NOT_FOUND', message: 'Not found.' });
    return;
  }

  const body = await readJsonBody(request);
  if (!body) {
    writeJson(response, 400, { code: 'INVALID_REQUEST', message: 'Request body must be valid JSON.' });
    return;
  }

  const turnRequest = parseExternalTurnRequest(body);
  if (!turnRequest) {
    writeJson(response, 400, {
      code: 'INVALID_REQUEST',
      message: 'botInstanceId, requestId, and text are required strings; text must not exceed 64KB.',
    });
    return;
  }

  await streamExternalTurn(dependencies, turnRequest, response);
}

async function handleBroadcast(
  dependencies: InternalHttpServerDependencies,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const broadcastService = dependencies.broadcastService ?? dependencies.broadcast;
  if (!broadcastService) {
    writeJson(response, 501, { code: 'NOT_CONFIGURED', message: 'Broadcast bridge is not configured.' });
    return;
  }

  const body = await readJsonBody(request);
  if (!body) {
    writeJson(response, 400, { code: 'INVALID_REQUEST', message: 'Request body must be valid JSON.' });
    return;
  }

  const broadcastRequest = parseBroadcastRequest(body);
  if (!broadcastRequest) {
    writeJson(response, 400, {
      code: 'INVALID_REQUEST',
      message: 'botInstanceId, text, and scope are required; text must not exceed 64KB; scope must be all, group, or selected.',
    });
    return;
  }

  try {
    const outcome = await broadcastService.sendBroadcast(broadcastRequest);
    writeJson(response, 200, outcome);
  } catch (error) {
    if (error instanceof BroadcastError) {
      writeJson(response, mapBroadcastErrorStatus(error.code), {
        code: error.code,
        message: error.message,
      });
      return;
    }
    writeJson(response, 500, {
      code: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Internal server error.',
    });
  }
}

async function handleListTasks(
  dependencies: InternalHttpServerDependencies,
  _request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  if (
    !dependencies.employeeDirectory
    || !dependencies.employeeGroups
    || !dependencies.groupTaskService
  ) {
    writeJson(response, 501, {
      code: 'NOT_CONFIGURED',
      message: 'Group task bridge is not configured.',
    });
    return;
  }

  const botInstanceId = url.searchParams.get('botInstanceId')?.trim() ?? '';
  if (!botInstanceId) {
    writeJson(response, 400, {
      code: 'INVALID_REQUEST',
      message: 'botInstanceId query parameter is required.',
    });
    return;
  }

  const senderEntry = await dependencies.employeeDirectory.findClaimedByBotInstanceId(
    botInstanceId,
  );
  if (!senderEntry) {
    writeJson(response, 404, { code: 'NOT_FOUND', message: 'Bot is not bound to an employee.' });
    return;
  }

  const tasks = await dependencies.groupTaskService.listByAssignee(senderEntry.id);
  const decoratedTasks = await Promise.all(tasks.map(async (task) => {
    const group = await dependencies.employeeGroups?.findById(task.groupId);
    const assigner = await dependencies.employeeDirectory?.findById(task.assignerEmployeeId);
    return {
      ...task,
      groupName: group?.name ?? null,
      assignerName: assigner ? (assigner.nickname ?? assigner.legalName) : null,
    };
  }));

  writeJson(response, 200, { tasks: decoratedTasks });
}

async function handleSubmitTask(
  dependencies: InternalHttpServerDependencies,
  request: IncomingMessage,
  response: ServerResponse,
  taskId: string,
): Promise<void> {
  if (
    !dependencies.employeeDirectory
    || !dependencies.groupTaskService
  ) {
    writeJson(response, 501, {
      code: 'NOT_CONFIGURED',
      message: 'Group task bridge is not configured.',
    });
    return;
  }

  const body = await readJsonBody(request);
  if (!body) {
    writeJson(response, 400, { code: 'INVALID_REQUEST', message: 'Request body must be valid JSON.' });
    return;
  }

  const submitRequest = parseSubmitTaskRequest(body);
  if (!submitRequest) {
    writeJson(response, 400, {
      code: 'INVALID_REQUEST',
      message: 'botInstanceId and summary are required strings.',
    });
    return;
  }

  const senderEntry = await dependencies.employeeDirectory.findClaimedByBotInstanceId(
    submitRequest.botInstanceId,
  );
  if (!senderEntry) {
    writeJson(response, 404, { code: 'NOT_FOUND', message: 'Bot is not bound to an employee.' });
    return;
  }

  const task = await dependencies.groupTaskService.findById(taskId);
  if (!task) {
    writeJson(response, 404, { code: 'NOT_FOUND', message: 'Task not found.' });
    return;
  }

  if (task.assigneeEmployeeId !== senderEntry.id) {
    writeJson(response, 403, {
      code: 'FORBIDDEN',
      message: 'Only the task assignee can submit it.',
    });
    return;
  }

  const submittedTask = await dependencies.groupTaskService.markSubmitted(taskId, {
    evidencePaths: submitRequest.evidencePaths,
    summary: submitRequest.summary,
  });
  if (!submittedTask) {
    throw new Error(`Failed to submit group task: ${taskId}`);
  }

  writeJson(response, 200, { task: submittedTask });
}

function parseBroadcastRequest(value: unknown): SendBroadcastInput | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as Partial<SendBroadcastInput>;
  const botInstanceId = typeof candidate.botInstanceId === 'string' ? candidate.botInstanceId.trim() : '';
  const text = typeof candidate.text === 'string' ? candidate.text : '';
  const scope = candidate.scope;
  if (!botInstanceId || typeof candidate.text !== 'string' || !isBroadcastScope(scope)) {
    return null;
  }
  const targetBotInstanceIds = Array.isArray(candidate.targetBotInstanceIds)
    ? candidate.targetBotInstanceIds
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
    : undefined;
  return { botInstanceId, text, scope, targetBotInstanceIds };
}

function parseSubmitTaskRequest(value: unknown): SubmitTaskRequest | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as Partial<SubmitTaskRequest>;
  const botInstanceId = typeof candidate.botInstanceId === 'string'
    ? candidate.botInstanceId.trim()
    : '';
  const summary = typeof candidate.summary === 'string'
    ? candidate.summary.trim()
    : '';
  if (!botInstanceId || !summary) {
    return null;
  }
  const evidencePaths = Array.isArray(candidate.evidencePaths)
    ? candidate.evidencePaths
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
    : [];
  return { botInstanceId, evidencePaths, summary };
}

function parseSubmitTaskPath(pathname: string): string | null {
  const match = /^\/internal\/me\/tasks\/([^/]+)\/submit$/.exec(pathname);
  if (!match) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function mapBroadcastErrorStatus(code: 'FORBIDDEN' | 'RATE_LIMITED' | 'INVALID_TEXT'): number {
  switch (code) {
    case 'FORBIDDEN':
      return 403;
    case 'RATE_LIMITED':
      return 429;
    case 'INVALID_TEXT':
      return 400;
    default:
      return 500;
  }
}

function isBroadcastScope(value: unknown): value is BroadcastScope {
  return value === 'all' || value === 'group' || value === 'selected';
}

function isAuthorized(request: IncomingMessage, apiToken: string): boolean {
  const header = request.headers.authorization;
  if (!header || !apiToken) {
    return false;
  }
  const expected = `Bearer ${apiToken}`;
  const actual = header.trim();
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length
    && timingSafeEqual(expectedBuffer, actualBuffer);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown | null> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      return null;
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return null;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

function parseExternalTurnRequest(value: unknown): ExternalTurnRequest | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as Partial<ExternalTurnRequest>;
  const botInstanceId = typeof candidate.botInstanceId === 'string' ? candidate.botInstanceId.trim() : '';
  const requestId = typeof candidate.requestId === 'string' ? candidate.requestId.trim() : '';
  const text = typeof candidate.text === 'string' ? candidate.text.trim() : '';
  if (!botInstanceId || !requestId || !text) {
    return null;
  }
  if (Buffer.byteLength(text, 'utf8') > 64 * 1024) {
    return null;
  }
  return { botInstanceId, requestId, text };
}

async function streamExternalTurn(
  dependencies: InternalHttpServerDependencies,
  turnRequest: ExternalTurnRequest,
  response: ServerResponse,
): Promise<void> {
  let finalText = '';
  let closed = false;

  try {
    dependencies.processManager.assertCanRunExternalTurn(
      turnRequest.botInstanceId,
      turnRequest.requestId,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'Bot process is not running.'
      || message === 'Bot process IPC channel is unavailable.') {
      writeJson(response, 409, { code: 'BOT_NOT_RUNNING', message });
      return;
    }
    if (message === 'External turn is already in progress.') {
      writeJson(response, 409, { code: 'TURN_IN_PROGRESS', message });
      return;
    }
    writeJson(response, 400, { code: 'INVALID_REQUEST', message });
    return;
  }

  response.writeHead(200, {
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'content-type': 'text/event-stream; charset=utf-8',
    'x-accel-buffering': 'no',
  });
  response.write(': connected\n\n');

  const keepalive = setInterval(() => {
    if (!closed && !response.destroyed) {
      response.write(': keepalive\n\n');
    }
  }, KEEPALIVE_INTERVAL_MS);

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    clearInterval(keepalive);
    response.end();
  };

  response.on('close', close);
  response.on('finish', close);

  const writeEvent = (event: string, data: unknown) => {
    if (closed || response.destroyed) {
      return;
    }
    const payload = JSON.stringify(data);
    response.write(`event: ${event}\ndata: ${payload}\n\n`);
  };

  writeEvent('turn_start', {});

  try {
    finalText = await dependencies.processManager.runExternalTurn(
      turnRequest.botInstanceId,
      turnRequest.requestId,
      turnRequest.text,
      {
        onEvent: (event) => {
          if (closed || response.destroyed) {
            return;
          }
          const frame = toSseFrame(event);
          if (!frame) {
            return;
          }
          if (frame.event === 'message_end') {
            if (typeof frame.data.text === 'string' && frame.data.text) {
              finalText = frame.data.text;
            }
            return;
          }
          writeEvent(frame.event, frame.data);
        },
        timeoutMs: EXTERNAL_TURN_TIMEOUT_MS,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (closed || response.destroyed) {
      return;
    }
    if (response.headersSent) {
      writeEvent('error', { message });
      close();
      return;
    }
    if (message === 'Bot process is not running.') {
      writeJson(response, 409, { code: 'BOT_NOT_RUNNING', message });
      return;
    }
    if (message === 'External turn is already in progress.') {
      writeJson(response, 409, { code: 'TURN_IN_PROGRESS', message });
      return;
    }
    if (message === 'Bot process IPC channel is unavailable.') {
      writeJson(response, 409, { code: 'BOT_NOT_RUNNING', message });
      return;
    }
    writeJson(response, 500, { code: 'INTERNAL_ERROR', message });
    return;
  }

  if (!closed && !response.destroyed) {
    writeEvent('message_end', { text: finalText });
  }

  close();
}

function toSseFrame(
  event: unknown,
): { data: Record<string, unknown>; event: string } | null {
  if (typeof event !== 'object' || event === null) {
    return null;
  }
  const candidate = event as { data?: unknown; type?: unknown };
  const type = typeof candidate.type === 'string' ? candidate.type : '';
  const eventData = typeof candidate.data === 'object' && candidate.data !== null
    ? candidate.data as Record<string, unknown>
    : {};

  if (type === 'message_delta') {
    const delta = typeof eventData.text === 'string' ? eventData.text : '';
    return delta ? { event: 'text_delta', data: { delta } } : null;
  }
  if (type === 'tool_call') {
    const toolCallId = typeof eventData.id === 'string'
      ? eventData.id
      : typeof eventData.providerToolCallId === 'string'
        ? eventData.providerToolCallId
        : String(eventData.id ?? '');
    const toolName = typeof eventData.name === 'string' ? eventData.name : '';
    if (!toolCallId || !toolName) {
      return null;
    }
    return {
      event: 'tool_call',
      data: { toolCallId, toolName, input: eventData.input ?? null },
    };
  }
  if (type === 'tool_result') {
    const toolCallId = typeof eventData.toolUseId === 'string'
      ? eventData.toolUseId
      : String(eventData.toolUseId ?? '');
    if (!toolCallId) {
      return null;
    }
    return {
      event: 'tool_result',
      data: {
        toolCallId,
        output: eventData.structuredContent ?? eventData.content ?? null,
      },
    };
  }
  if (type === 'message_end') {
    return {
      event: 'message_end',
      data: { text: typeof eventData.text === 'string' ? eventData.text : '' },
    };
  }
  return null;
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) {
    return;
  }
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}
