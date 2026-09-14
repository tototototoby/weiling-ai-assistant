import { beforeEach, describe, expect, it, vi } from 'vitest';

const createMock = vi.fn(async (input: Record<string, unknown>) => ({
  ...input,
  createdAt: new Date(),
  id: 'msg_mock',
  updatedAt: new Date(),
}));
const markResultMock = vi.fn(async () => undefined);
const listByBotInstanceIdMock = vi.fn(async () => []);
const requireRequestSessionMock = vi.fn();
const requireOwnedBotMock = vi.fn();

vi.mock('@weiling-ai/db', () => ({
  WebChatMessageRepository: class {
    readonly create = createMock;
    readonly listByBotInstanceId = listByBotInstanceIdMock;
    readonly markResult = markResultMock;
  },
}));

vi.mock('@/lib/session', () => ({
  requireOwnedBot: requireOwnedBotMock,
  requireRequestSession: requireRequestSessionMock,
}));

vi.mock('@/lib/repositories', () => ({
  getDatabaseClient: () => ({ db: {} }),
}));

describe('/api/bots/[id]/chat route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('WECLAWS_INTERNAL_API_TOKEN', 'secret');
    vi.stubEnv('SUPERVISOR_INTERNAL_URL', 'http://supervisor:8790');
    requireRequestSessionMock.mockResolvedValue({ user: { email: 'owner@example.com', id: 'user_1' } });
    requireOwnedBotMock.mockResolvedValue(undefined);
  });

  it('rejects unauthenticated and non-owned requests', async () => {
    const { ApiError } = await import('@/lib/api-error');
    requireRequestSessionMock.mockRejectedValue(new ApiError({
      code: 'UNAUTHORIZED',
      message: 'Unauthorized.',
      status: 401,
    }));

    const { POST } = await import('../route');
    const response = await POST(
      new Request('http://localhost/api/bots/bot_1/chat', {
        body: JSON.stringify({ text: 'hi' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'bot_1' }) },
    );

    expect(response.status).toBe(401);
    expect(requireOwnedBotMock).not.toHaveBeenCalled();
  });

  it('rejects empty messages', async () => {
    const { POST } = await import('../route');
    const response = await POST(
      new Request('http://localhost/api/bots/bot_1/chat', {
        body: JSON.stringify({ messages: [{ role: 'user', content: '   ' }] }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'bot_1' }) },
    );

    expect(response.status).toBe(400);
  });

  it('returns 503 when the bridge token is not configured', async () => {
    vi.stubEnv('WECLAWS_INTERNAL_API_TOKEN', '');

    const { POST } = await import('../route');
    const response = await POST(
      new Request('http://localhost/api/bots/bot_1/chat', {
        body: JSON.stringify({ text: 'hi' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'bot_1' }) },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'SERVER_NOT_CONFIGURED' },
    });
  });

  it('maps BOT_NOT_RUNNING from the bridge to HTTP 409 and marks the message failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: 'BOT_NOT_RUNNING', message: 'Bot process is not running.' }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    )));

    const { POST } = await import('../route');
    const response = await POST(
      new Request('http://localhost/api/bots/bot_1/chat', {
        body: JSON.stringify({ text: 'hi' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'bot_1' }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'BOT_NOT_RUNNING' },
    });
    expect(markResultMock).toHaveBeenCalledWith(
      'msg_mock',
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('streams AI SDK frames and persists user and assistant messages', async () => {
    const sse = 'event: turn_start\ndata: {}\n\n'
      + 'event: text_delta\ndata: {"delta":"你好"}\n\n'
      + 'event: message_end\ndata: {"text":"你好"}\n\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(sse, {
      headers: { 'content-type': 'text/event-stream' },
      status: 200,
    })));

    const { POST } = await import('../route');
    const response = await POST(
      new Request('http://localhost/api/bots/bot_1/chat', {
        body: JSON.stringify({ text: '你好' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'bot_1' }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-vercel-ai-ui-message-stream')).toBe('v1');
    const body = await response.text();
    expect(body).toContain('"type":"start"');
    expect(body).toContain('"type":"text-delta"');
    expect(body).toContain('"type":"finish"');
    expect(body).toContain('data: [DONE]');

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ role: 'user' }));
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ role: 'assistant' }));
    expect(markResultMock).toHaveBeenCalledWith(
      'msg_mock',
      expect.objectContaining({ status: 'succeeded' }),
    );
  });
});
