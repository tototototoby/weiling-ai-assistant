import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireRequestSessionMock = vi.fn();
const requireOwnedBotMock = vi.fn();
const getBotDetailMock = vi.fn();
const listBotEventsMock = vi.fn();
const listBotEventsAfterCursorMock = vi.fn();

vi.mock('@/lib/session', () => ({
  requireRequestSession: requireRequestSessionMock,
  requireOwnedBot: requireOwnedBotMock,
}));

vi.mock('@/lib/bot-service', () => ({
  getBotDetail: getBotDetailMock,
  listBotEvents: listBotEventsMock,
  listBotEventsAfterCursor: listBotEventsAfterCursorMock,
}));

describe('/api/bots/[id]/stream route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns 401 when the caller is not authenticated', async () => {
    const { ApiError } = await import('@/lib/api-error');
    requireRequestSessionMock.mockRejectedValue(new ApiError({
      code: 'UNAUTHORIZED',
      message: 'Please sign in.',
      status: 401,
    }));

    const { GET } = await import('../stream/route');
    const response = await GET(new Request('http://localhost/api/bots/bot_1/stream'), {
      params: Promise.resolve({ id: 'bot_1' }),
    });

    expect(response.status).toBe(401);
  });

  it('returns sse headers and an initial status event', async () => {
    requireRequestSessionMock.mockResolvedValue({
      user: { id: 'user_1', email: 'zac@example.com' },
    });
    requireOwnedBotMock.mockResolvedValue({
      id: 'bot_1',
      ownerUserId: 'user_1',
    });
    getBotDetailMock.mockResolvedValue({
      id: 'bot_1',
      status: 'waiting_for_qr',
      desiredState: 'running',
      processPid: 120,
      processStartedAt: '2026-03-30T00:00:00.000Z',
      heartbeatAt: null,
      lastQrCodeId: null,
      lastQrCodeUrl: null,
      weixinAccountId: 'wx_acc_1',
      lastErrorCode: null,
      lastErrorMessage: null,
    });
    listBotEventsMock.mockResolvedValue([]);
    listBotEventsAfterCursorMock.mockResolvedValue([]);

    const { GET } = await import('../stream/route');
    const response = await GET(new Request('http://localhost/api/bots/bot_1/stream'), {
      params: Promise.resolve({ id: 'bot_1' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toContain('no-cache');

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const firstChunk = await reader?.read();
    const payload = new TextDecoder().decode(firstChunk?.value);

    expect(payload).toContain('event: bot.status.updated');
    expect(payload).toContain('"id":"bot_1"');
    expect(payload).toContain('"processPid":120');
    expect(payload).toContain('"weixinAccountId":"wx_acc_1"');

    await reader?.cancel();
  });

  it('keeps the first stream status frame aligned with the detail dto for real runtime payloads', async () => {
    requireRequestSessionMock.mockResolvedValue({
      user: { id: 'user_1', email: 'zac@example.com' },
    });
    requireOwnedBotMock.mockResolvedValue({
      id: 'bot_1',
      ownerUserId: 'user_1',
    });
    const realDetail = {
      id: 'bot_1',
      name: 'Bot One',
      provider: 'openai',
      model: 'gpt-5.4',
      workspaceId: 'ws_1',
      desiredState: 'running',
      status: 'running',
      processPid: 84721,
      processStartedAt: '2026-03-30T10:18:18.753Z',
      heartbeatAt: '2026-03-30T10:18:19.068Z',
      restartRequestedAt: null,
      lastQrCodeId: null,
      lastQrCodeUrl: 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=00000000000000000000000000000000&bot_type=3',
      weixinAccountId: '0123456789ab@im.bot',
      lastErrorCode: 'RUNTIME_ERROR',
      lastErrorMessage: 'Sandbox session crashed unexpectedly',
      createdAt: '2026-03-30T00:00:00.000Z',
      updatedAt: '2026-03-30T10:18:19.068Z',
    };
    getBotDetailMock.mockResolvedValue(realDetail);
    listBotEventsMock.mockResolvedValue([]);
    listBotEventsAfterCursorMock.mockResolvedValue([]);

    const { GET } = await import('../stream/route');
    const response = await GET(new Request('http://localhost/api/bots/bot_1/stream'), {
      params: Promise.resolve({ id: 'bot_1' }),
    });

    const reader = response.body?.getReader();
    const firstChunk = await reader?.read();
    const payload = new TextDecoder().decode(firstChunk?.value);

    expect(payload).toContain('event: bot.status.updated');
    expect(payload).toContain('"lastQrCodeId":null');
    expect(payload).toContain('"lastQrCodeUrl":"https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=00000000000000000000000000000000&bot_type=3"');
    expect(payload).toContain('"weixinAccountId":"0123456789ab@im.bot"');
    expect(payload).toContain('"lastErrorMessage":"Sandbox session crashed unexpectedly"');

    await reader?.cancel();
  });

  it('sanitizes snapshot failures into a stream-level error event', async () => {
    requireRequestSessionMock.mockResolvedValue({
      user: { id: 'user_1', email: 'zac@example.com' },
    });
    requireOwnedBotMock.mockResolvedValue({
      id: 'bot_1',
      ownerUserId: 'user_1',
    });
    getBotDetailMock.mockRejectedValue(new Error('sqlite constraint failed at /private/tmp/test.sqlite'));

    const { GET } = await import('../stream/route');
    const response = await GET(new Request('http://localhost/api/bots/bot_1/stream'), {
      params: Promise.resolve({ id: 'bot_1' }),
    });

    const reader = response.body?.getReader();
    const firstChunk = await reader?.read();
    const payload = new TextDecoder().decode(firstChunk?.value);

    expect(payload).toContain('event: bot.stream.error');
    expect(payload).toContain('"message":"Unexpected server error."');
    expect(payload).not.toContain('/private/tmp/test.sqlite');

    await reader?.cancel();
  });
});
