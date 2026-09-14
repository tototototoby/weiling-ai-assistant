import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdminRequestSessionMock = vi.fn();
const getRepositoriesMock = vi.fn();
const getAdminBotFeishuConfigMock = vi.fn();
const updateAdminBotFeishuConfigMock = vi.fn();
const deleteAdminBotFeishuConfigMock = vi.fn();

vi.mock('@/lib/admin', () => ({
  requireAdminRequestSession: requireAdminRequestSessionMock,
}));

vi.mock('@/lib/repositories', () => ({
  getRepositories: getRepositoriesMock,
}));

vi.mock('@/lib/feishu-admin', () => ({
  deleteAdminBotFeishuConfig: deleteAdminBotFeishuConfigMock,
  getAdminBotFeishuConfig: getAdminBotFeishuConfigMock,
  updateAdminBotFeishuConfig: updateAdminBotFeishuConfigMock,
}));

describe('/api/admin/bots/[id]/feishu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminRequestSessionMock.mockResolvedValue({
      user: { email: 'admin@example.com', id: 'admin_1' },
    });
    getRepositoriesMock.mockReturnValue({ repository: true });
  });

  it('reads a single Bot Feishu configuration', async () => {
    getAdminBotFeishuConfigMock.mockResolvedValue({ botId: 'bot_1' });
    const { GET } = await import('../route');

    const response = await GET(
      new Request('http://localhost/api/admin/bots/bot_1/feishu'),
      { params: Promise.resolve({ id: 'bot_1' }) },
    );

    expect(response.status).toBe(200);
    expect(getAdminBotFeishuConfigMock).toHaveBeenCalledWith('bot_1', { repository: true });
  });

  it('updates a Bot Feishu configuration with the authenticated admin id', async () => {
    updateAdminBotFeishuConfigMock.mockResolvedValue({ botId: 'bot_1', enabled: true });
    const { PATCH } = await import('../route');
    const payload = { appId: 'cli_app-one', appSecret: 'secret-one', enabled: true };

    const response = await PATCH(
      new Request('http://localhost/api/admin/bots/bot_1/feishu', {
        body: JSON.stringify(payload),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      }),
      { params: Promise.resolve({ id: 'bot_1' }) },
    );

    expect(response.status).toBe(200);
    expect(updateAdminBotFeishuConfigMock).toHaveBeenCalledWith({
      botId: 'bot_1',
      payload,
      repositories: { repository: true },
      updatedByUserId: 'admin_1',
    });
  });

  it('clears a Bot Feishu configuration', async () => {
    deleteAdminBotFeishuConfigMock.mockResolvedValue({ botId: 'bot_1', enabled: false });
    const { DELETE } = await import('../route');

    const response = await DELETE(
      new Request('http://localhost/api/admin/bots/bot_1/feishu', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'bot_1' }) },
    );

    expect(response.status).toBe(200);
    expect(deleteAdminBotFeishuConfigMock).toHaveBeenCalledWith({
      botId: 'bot_1',
      repositories: { repository: true },
      updatedByUserId: 'admin_1',
    });
  });
});
