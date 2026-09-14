import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdminRequestSessionMock = vi.fn();
const getAdminBotWecomBindingMock = vi.fn();
const updateAdminBotWecomBindingMock = vi.fn();
const deleteAdminBotWecomBindingMock = vi.fn();

vi.mock('@/lib/admin', () => ({
  requireAdminRequestSession: requireAdminRequestSessionMock,
}));
vi.mock('@/lib/repositories', () => ({ getRepositories: () => ({}) }));
vi.mock('@/lib/wecom-admin', () => ({
  deleteAdminBotWecomBinding: deleteAdminBotWecomBindingMock,
  getAdminBotWecomBinding: getAdminBotWecomBindingMock,
  updateAdminBotWecomBinding: updateAdminBotWecomBindingMock,
}));

describe('/api/admin/bots/[id]/wecom', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminRequestSessionMock.mockResolvedValue({ user: { id: 'admin_1' } });
  });

  it('reads a Bot channel binding', async () => {
    const binding = { botId: 'bot_1', bound: false };
    getAdminBotWecomBindingMock.mockResolvedValue(binding);
    const { GET } = await import('../route');

    const response = await GET(
      new Request('http://localhost/api/admin/bots/bot_1/wecom'),
      { params: Promise.resolve({ id: 'bot_1' }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: binding, error: null });
    expect(getAdminBotWecomBindingMock).toHaveBeenCalledWith('bot_1', {});
  });

  it('updates a Bot channel binding', async () => {
    const binding = { botId: 'bot_1', bound: true, wecomUserId: 'zhangting' };
    updateAdminBotWecomBindingMock.mockResolvedValue(binding);
    const { PATCH } = await import('../route');
    const payload = {
      enabled: true,
      preferredForProactive: true,
      wecomUserId: 'zhangting',
    };

    const response = await PATCH(new Request('http://localhost/api/admin/bots/bot_1/wecom', {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }), { params: Promise.resolve({ id: 'bot_1' }) });

    expect(response.status).toBe(200);
    expect(updateAdminBotWecomBindingMock).toHaveBeenCalledWith({
      botId: 'bot_1',
      payload,
      repositories: {},
    });
  });

  it('unbinds the Bot channel', async () => {
    deleteAdminBotWecomBindingMock.mockResolvedValue({ botId: 'bot_1', bound: false });
    const { DELETE } = await import('../route');

    const response = await DELETE(
      new Request('http://localhost/api/admin/bots/bot_1/wecom', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'bot_1' }) },
    );

    expect(response.status).toBe(200);
    expect(deleteAdminBotWecomBindingMock).toHaveBeenCalledWith({
      botId: 'bot_1',
      repositories: {},
    });
  });
});
