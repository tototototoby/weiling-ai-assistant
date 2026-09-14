import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdminRequestSessionMock = vi.fn();
const getRepositoriesMock = vi.fn();
const listAdminDifyMock = vi.fn();
const updateAdminDifyMock = vi.fn();

vi.mock('@/lib/admin', () => ({
  requireAdminRequestSession: requireAdminRequestSessionMock,
}));

vi.mock('@/lib/repositories', () => ({
  getRepositories: getRepositoriesMock,
}));

vi.mock('@/lib/dify-admin', () => ({
  listAdminDify: listAdminDifyMock,
  updateAdminDify: updateAdminDifyMock,
}));

describe('/api/admin/dify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminRequestSessionMock.mockResolvedValue({
      user: { email: 'admin@example.com', id: 'admin_1' },
    });
    getRepositoriesMock.mockReturnValue({ repository: true });
  });

  it('requires an admin session before listing configuration', async () => {
    listAdminDifyMock.mockResolvedValue({ config: { apiKeyConfigured: true } });
    const { GET } = await import('../route');

    const response = await GET(new Request('http://localhost/api/admin/dify'));

    expect(response.status).toBe(200);
    expect(requireAdminRequestSessionMock).toHaveBeenCalled();
    expect(listAdminDifyMock).toHaveBeenCalledWith({ repository: true });
  });

  it('passes the authenticated administrator id to configuration updates', async () => {
    updateAdminDifyMock.mockResolvedValue({ config: { revision: 2 } });
    const { PATCH } = await import('../route');
    const payload = {
      apiBaseUrl: 'https://dify.example.com/v1',
      apiKey: 'secret',
      appName: 'Company KB',
      enabled: true,
    };

    const response = await PATCH(new Request('http://localhost/api/admin/dify', {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }));

    expect(response.status).toBe(200);
    expect(updateAdminDifyMock).toHaveBeenCalledWith({
      payload,
      repositories: { repository: true },
      updatedByUserId: 'admin_1',
    });
  });
});
