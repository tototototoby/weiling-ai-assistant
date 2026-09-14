import { createInterface } from 'node:readline';
// @ts-expect-error better-sqlite3 is a runtime dependency without a local declaration surface.
import BetterSqlite3 from 'better-sqlite3';
import { queryRagflowKnowledge } from './runtime/ragflow-client';

const SERVER_NAME = 'weclaws-managed';
const SERVER_VERSION = '1.0.0';
const botInstanceId = requiredEnv('IM_GATEWAY_AGENT_ID');
const databasePath = normalizeDatabasePath(requiredEnv('WECLAWS_DATABASE_URL'));
const configRevision = Number(process.env.DIFY_CONFIG_REVISION ?? '0');
const database = new BetterSqlite3(databasePath);

database.pragma('foreign_keys = ON');

const tools = [
  {
    name: 'dify_knowledge_query',
    description: 'Query the centrally configured Dify knowledge-base application. Use this first for focused knowledge lookups, including a person\'s name, department, title, phone, email, office location, or other relevant details. User identity and Dify conversation isolation are enforced by the platform; an empty or incomplete local roster must not block the query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The focused knowledge question, including the person name and the specific field requested when applicable.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'ragflow_knowledge_query',
    description: 'Search the centrally configured RAGFlow datasets and return the most relevant knowledge chunks.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The focused knowledge question.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_meal_order_reminder',
    description: 'Read whether the current employee has enabled the workday meal-order reminder.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'set_meal_order_reminder',
    description: 'Enable or disable the current employee workday meal-order reminder after the employee explicitly answers the onboarding question or requests a later change.',
    inputSchema: {
      type: 'object',
      properties: { enabled: { type: 'boolean' } },
      required: ['enabled'],
      additionalProperties: false,
    },
  },
] as const;

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  void handleLine(line);
});
input.on('close', () => {
  database.close();
});

async function handleLine(line: string): Promise<void> {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
  } catch {
    writeError(null, -32700, 'Parse error');
    return;
  }

  if (request.id === undefined) return;

  try {
    if (request.method === 'initialize') {
      const requestedVersion = isRecord(request.params) && typeof request.params.protocolVersion === 'string'
        ? request.params.protocolVersion
        : '2024-11-05';
      writeResult(request.id, {
        capabilities: { tools: { listChanged: false } },
        protocolVersion: requestedVersion,
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
      return;
    }

    if (request.method === 'ping') {
      writeResult(request.id, {});
      return;
    }

    if (request.method === 'tools/list') {
      writeResult(request.id, { tools });
      return;
    }

    if (request.method === 'tools/call') {
      const result = await callTool(request.params);
      writeResult(request.id, {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      });
      return;
    }

    writeError(request.id, -32601, `Method not found: ${request.method}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeResult(request.id, {
      content: [{ type: 'text', text: JSON.stringify({ error: message, ok: false }) }],
      isError: true,
    });
  }
}

async function callTool(params: unknown): Promise<Record<string, unknown>> {
  if (!isRecord(params) || typeof params.name !== 'string') {
    throw new Error('tools/call requires a tool name.');
  }
  const args = isRecord(params.arguments) ? params.arguments : {};

  if (params.name === 'dify_knowledge_query') {
    if (typeof args.query !== 'string' || !args.query.trim()) {
      throw new Error('Dify knowledge query must not be empty.');
    }
    return queryDify(args.query.trim());
  }

  if (params.name === 'ragflow_knowledge_query') {
    if (typeof args.query !== 'string' || !args.query.trim()) {
      throw new Error('RAGFlow knowledge query must not be empty.');
    }
    const result = await queryRagflowKnowledge({
      apiBaseUrl: process.env.RAGFLOW_API_BASE_URL ?? '',
      apiKey: process.env.RAGFLOW_API_KEY ?? '',
      datasetIds: parseRagflowDatasetIds(process.env.RAGFLOW_DATASET_IDS_JSON),
      knowledgeBaseName: process.env.RAGFLOW_KNOWLEDGE_BASE_NAME ?? '',
      query: args.query,
    });
    return { ...result };
  }

  if (params.name === 'get_meal_order_reminder') {
    return getMealReminder();
  }

  if (params.name === 'set_meal_order_reminder') {
    if (typeof args.enabled !== 'boolean') {
      throw new Error('enabled must be a boolean.');
    }
    return setMealReminder(args.enabled);
  }

  throw new Error(`Unknown tool: ${params.name}`);
}

async function queryDify(query: string): Promise<Record<string, unknown>> {
  const baseUrl = process.env.DIFY_API_BASE_URL?.trim().replace(/\/+$/, '');
  const apiKey = process.env.DIFY_API_KEY?.trim();
  if (!baseUrl || !apiKey) throw new Error('The administrator has not enabled and configured Dify.');
  if (query.length > 8_000) throw new Error('Dify knowledge query exceeds 8000 characters.');

  const current = database.prepare(
    'select conversation_id as conversationId, config_revision as configRevision from bot_dify_conversations where bot_instance_id = ?',
  ).get(botInstanceId) as { conversationId: string; configRevision: number } | undefined;
  const conversationId = current?.configRevision === configRevision ? current.conversationId : '';
  const response = await fetch(`${baseUrl}/chat-messages`, {
    body: JSON.stringify({
      conversation_id: conversationId,
      inputs: {},
      query,
      response_mode: 'blocking',
      user: `weclaws:${botInstanceId}`,
    }),
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    method: 'POST',
    signal: AbortSignal.timeout(45_000),
  });
  const body = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`Dify query failed (${response.status}): ${readDifyError(body)}`);
  }
  if (!isRecord(body) || typeof body.answer !== 'string') {
    throw new Error('Dify returned an invalid knowledge response.');
  }

  if (typeof body.conversation_id === 'string' && body.conversation_id) {
    database.prepare(`
      insert into bot_dify_conversations (bot_instance_id, conversation_id, config_revision, updated_at)
      values (?, ?, ?, ?)
      on conflict(bot_instance_id) do update set
        conversation_id = excluded.conversation_id,
        config_revision = excluded.config_revision,
        updated_at = excluded.updated_at
    `).run(botInstanceId, body.conversation_id, configRevision, Date.now());
  }

  return {
    answer: body.answer,
    application: process.env.DIFY_APP_NAME || 'Knowledge base',
    metadata: sanitizeDifyMetadata(body.metadata),
    ok: true,
  };
}

function getMealReminder(): Record<string, unknown> {
  const row = database.prepare(
    'select status, city, last_reminder_date as lastReminderDate from bot_meal_reminder_preferences where bot_instance_id = ?',
  ).get(botInstanceId) as { city: string; lastReminderDate: string | null; status: string } | undefined;
  return {
    city: row?.city ?? '北京',
    enabled: row?.status === 'enabled',
    lastReminderDate: row?.lastReminderDate ?? null,
    ok: true,
    status: row?.status ?? 'unasked',
  };
}

function setMealReminder(enabled: boolean): Record<string, unknown> {
  const now = Date.now();
  const status = enabled ? 'enabled' : 'disabled';
  database.prepare(`
    insert into bot_meal_reminder_preferences (bot_instance_id, status, city, created_at, updated_at)
    values (?, ?, '北京', ?, ?)
    on conflict(bot_instance_id) do update set status = excluded.status, updated_at = excluded.updated_at
  `).run(botInstanceId, status, now, now);
  return {
    enabled,
    normalReminderTime: '10:45',
    ok: true,
    rainyReminderTime: '10:30',
    schedule: '中国法定工作日及调休工作日',
  };
}

function sanitizeDifyMetadata(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const resources = Array.isArray(value.retriever_resources)
    ? value.retriever_resources.slice(0, 8).map((item) => {
      if (!isRecord(item)) return null;
      return {
        content: typeof item.content === 'string' ? item.content.slice(0, 1_500) : undefined,
        documentName: typeof item.document_name === 'string' ? item.document_name : undefined,
        score: typeof item.score === 'number' ? item.score : undefined,
      };
    }).filter(Boolean)
    : [];
  return { retrieverResources: resources };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}

function readDifyError(value: unknown): string {
  if (isRecord(value)) {
    for (const key of ['message', 'error', 'code']) {
      if (typeof value[key] === 'string' && value[key]) return value[key];
    }
  }
  return 'unknown error';
}

function parseRagflowDatasetIds(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function normalizeDatabasePath(value: string): string {
  return value.startsWith('file:') ? value.slice(5) : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function writeResult(id: JsonRpcId, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ id, jsonrpc: '2.0', result })}\n`);
}

function writeError(id: JsonRpcId, code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ error: { code, message }, id, jsonrpc: '2.0' })}\n`);
}

type JsonRpcId = string | number | null;
interface JsonRpcRequest {
  id?: JsonRpcId;
  jsonrpc?: string;
  method: string;
  params?: unknown;
}
