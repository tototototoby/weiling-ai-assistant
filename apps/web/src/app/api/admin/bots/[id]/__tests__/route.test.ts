import { beforeEach, describe, expect, it, vi } from 'vitest';

const deleteBotMock = vi.fn();
const requireAdminRequestSessionMock = vi.fn();

vi.mock('@/lib/admin', () => ({
  requireAdminRequestSession: requireAdminRequestSessionMock,
}));

vi.mock('@/lib/bot-service', () => ({
  deleteBot: deleteBotMock,
}));

describe('/api/admin/bots/[id] route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('deletes a bot for administrators', async () => {
    requireAdminRequestSessionMock.mockResolvedValue({ user: { email: 'admin@example.com', id: 'admin_1' } });
    deleteBotMock.mockResolvedValue({ id: 'bot_1' });

    const { DELETE } = await import('../route');
    const response = await DELETE(new Request('http://localhost/api/admin/bots/bot_1', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'bot_1' }),
    });

    expect(deleteBotMock).toHaveBeenCalledWith('bot_1');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { id: 'bot_1' }, error: null });
  });

  it('returns the service error when deletion is not allowed', async () => {
    requireAdminRequestSessionMock.mockResolvedValue({ user: { email: 'admin@example.com', id: 'admin_1' } });
    const { ApiError } = await import('@/lib/api-error');
    deleteBotMock.mockRejectedValue(new ApiError({
      code: 'BOT_DELETE_NOT_ALLOWED',
      message: 'Stop the bot completely before deleting it.',
      status: 409,
    }));

    const { DELETE } = await import('../route');
    const response = await DELETE(new Request('http://localhost/api/admin/bots/bot_1', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'bot_1' }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: { code: 'BOT_DELETE_NOT_ALLOWED', message: 'Stop the bot completely before deleting it.' },
    });
  });
});
