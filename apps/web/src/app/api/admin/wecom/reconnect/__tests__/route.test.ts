import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdminRequestSessionMock = vi.fn();
const getRepositoriesMock = vi.fn();
const requestAdminWecomReconnectMock = vi.fn();

vi.mock('@/lib/admin', () => ({
  requireAdminRequestSession: requireAdminRequestSessionMock,
}));

vi.mock('@/lib/repositories', () => ({
  getRepositories: getRepositoriesMock,
}));

vi.mock('@/lib/wecom-admin', () => ({
  requestAdminWecomReconnect: requestAdminWecomReconnectMock,
}));

describe('/api/admin/wecom/reconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminRequestSessionMock.mockResolvedValue({ user: { id: 'admin_1' } });
    getRepositoriesMock.mockReturnValue({ repository: true });
  });

  it('authenticates and writes the durable reconnect intent', async () => {
    requestAdminWecomReconnectMock.mockResolvedValue({ config: { revision: 3 } });
    const { POST } = await import('../route');

    const response = await POST(new Request('http://localhost/api/admin/wecom/reconnect', {
      method: 'POST',
    }));

    expect(response.status).toBe(200);
    expect(requireAdminRequestSessionMock).toHaveBeenCalledOnce();
    expect(requestAdminWecomReconnectMock).toHaveBeenCalledWith({
      repositories: { repository: true },
      updatedByUserId: 'admin_1',
    });
  });
});
