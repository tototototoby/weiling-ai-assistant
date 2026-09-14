import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdminRequestSessionMock = vi.fn();
const getRepositoriesMock = vi.fn();
const listAdminFeishuMock = vi.fn();

vi.mock('@/lib/admin', () => ({
  requireAdminRequestSession: requireAdminRequestSessionMock,
}));

vi.mock('@/lib/repositories', () => ({
  getRepositories: getRepositoriesMock,
}));

vi.mock('@/lib/feishu-admin', () => ({
  listAdminFeishu: listAdminFeishuMock,
}));

describe('/api/admin/feishu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminRequestSessionMock.mockResolvedValue({
      user: { email: 'admin@example.com', id: 'admin_1' },
    });
    getRepositoriesMock.mockReturnValue({ repository: true });
  });

  it('requires an administrator session and returns the Feishu payload', async () => {
    listAdminFeishuMock.mockResolvedValue({ bots: [] });
    const { GET } = await import('../route');

    const response = await GET(new Request('http://localhost/api/admin/feishu'));

    expect(response.status).toBe(200);
    expect(requireAdminRequestSessionMock).toHaveBeenCalledOnce();
    expect(listAdminFeishuMock).toHaveBeenCalledWith({ repository: true });
  });
});
