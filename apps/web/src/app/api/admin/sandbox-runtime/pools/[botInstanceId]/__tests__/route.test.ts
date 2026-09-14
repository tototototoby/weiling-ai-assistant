import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdminRequestSessionMock = vi.fn();
const getRepositoriesMock = vi.fn();
const updateAdminSandboxRuntimePoolMock = vi.fn();

vi.mock('@/lib/admin', () => ({
  requireAdminRequestSession: requireAdminRequestSessionMock,
}));

vi.mock('@/lib/repositories', () => ({
  getRepositories: getRepositoriesMock,
}));

vi.mock('@/lib/sandbox-runtime-admin', () => ({
  updateAdminSandboxRuntimePool: updateAdminSandboxRuntimePoolMock,
}));

describe('/api/admin/sandbox-runtime/pools/[botInstanceId] route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getRepositoriesMock.mockReturnValue({ repositories: true });
  });

  it('updates one Bot sandbox runtime pool for admins', async () => {
    requireAdminRequestSessionMock.mockResolvedValue({
      user: { email: 'admin@example.com', id: 'admin_1' },
    });
    updateAdminSandboxRuntimePoolMock.mockResolvedValue({
      botInstanceId: 'bot_1',
      enabled: false,
    });

    const { PATCH } = await import('../route');
    const response = await PATCH(
      new Request('http://localhost/api/admin/sandbox-runtime/pools/bot_1', {
        body: JSON.stringify({ enabled: false }),
        method: 'PATCH',
      }),
      { params: Promise.resolve({ botInstanceId: 'bot_1' }) },
    );

    expect(updateAdminSandboxRuntimePoolMock).toHaveBeenCalledWith({
      botInstanceId: 'bot_1',
      payload: { enabled: false },
      repositories: { repositories: true },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { botInstanceId: 'bot_1', enabled: false },
      error: null,
    });
  });

  it('returns stable SRT validation errors from the service', async () => {
    const { ApiError } = await import('@/lib/api-error');
    requireAdminRequestSessionMock.mockResolvedValue({
      user: { email: 'admin@example.com', id: 'admin_1' },
    });
    updateAdminSandboxRuntimePoolMock.mockRejectedValue(new ApiError({
      code: 'SRT_POOL_INVALID_CONFIG',
      message: 'Invalid sandbox runtime pool config.',
      status: 400,
    }));

    const { PATCH } = await import('../route');
    const response = await PATCH(
      new Request('http://localhost/api/admin/sandbox-runtime/pools/bot_1', {
        body: JSON.stringify({ apiKey: 'secret' }),
        method: 'PATCH',
      }),
      { params: Promise.resolve({ botInstanceId: 'bot_1' }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: {
        code: 'SRT_POOL_INVALID_CONFIG',
        message: 'Invalid sandbox runtime pool config.',
      },
    });
  });
});
