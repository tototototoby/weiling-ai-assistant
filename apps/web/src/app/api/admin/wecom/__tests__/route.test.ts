import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdminRequestSessionMock = vi.fn();
const getRepositoriesMock = vi.fn();
const listAdminWecomMock = vi.fn();
const updateAdminWecomConfigMock = vi.fn();

vi.mock('@/lib/admin', () => ({
  requireAdminRequestSession: requireAdminRequestSessionMock,
}));

vi.mock('@/lib/repositories', () => ({
  getRepositories: getRepositoriesMock,
}));

vi.mock('@/lib/wecom-admin', () => ({
  listAdminWecom: listAdminWecomMock,
  updateAdminWecomConfig: updateAdminWecomConfigMock,
}));

describe('/api/admin/wecom', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminRequestSessionMock.mockResolvedValue({
      user: { email: 'admin@example.com', id: 'admin_1' },
    });
    getRepositoriesMock.mockReturnValue({ repository: true });
  });

  it('requires an administrator session when reading configuration', async () => {
    listAdminWecomMock.mockResolvedValue({ config: { secretConfigured: true } });
    const { GET } = await import('../route');

    const response = await GET(new Request('http://localhost/api/admin/wecom'));

    expect(response.status).toBe(200);
    expect(requireAdminRequestSessionMock).toHaveBeenCalledOnce();
    expect(listAdminWecomMock).toHaveBeenCalledWith({ repository: true });
  });

  it('passes the authenticated administrator id to configuration updates', async () => {
    updateAdminWecomConfigMock.mockResolvedValue({ config: { revision: 2 } });
    const { PATCH } = await import('../route');
    const payload = {
      botId: 'bot_id',
      enabled: true,
      secret: 'secret',
      wsUrl: 'wss://openws.work.weixin.qq.com',
    };

    const response = await PATCH(new Request('http://localhost/api/admin/wecom', {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }));

    expect(response.status).toBe(200);
    expect(updateAdminWecomConfigMock).toHaveBeenCalledWith({
      payload,
      repositories: { repository: true },
      updatedByUserId: 'admin_1',
    });
  });

  it('returns a controlled error for malformed JSON', async () => {
    const { PATCH } = await import('../route');

    const response = await PATCH(new Request('http://localhost/api/admin/wecom', {
      body: '{',
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'INVALID_JSON_BODY' },
    });
  });
});
