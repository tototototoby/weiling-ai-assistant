import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdminRequestSessionMock = vi.fn();
const getRepositoriesMock = vi.fn();
const testAdminDifyConnectionMock = vi.fn();

vi.mock('@/lib/admin', () => ({
  requireAdminRequestSession: requireAdminRequestSessionMock,
}));

vi.mock('@/lib/repositories', () => ({
  getRepositories: getRepositoriesMock,
}));

vi.mock('@/lib/dify-admin', () => ({
  testAdminDifyConnection: testAdminDifyConnectionMock,
}));

describe('/api/admin/dify/test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminRequestSessionMock.mockResolvedValue({ user: { id: 'admin_1' } });
    getRepositoriesMock.mockReturnValue({ repository: true });
  });

  it('requires an administrator and delegates connection testing server-side', async () => {
    testAdminDifyConnectionMock.mockResolvedValue({ config: { lastTestStatus: 'success' } });
    const { POST } = await import('../route');
    const payload = { apiBaseUrl: 'https://dify.example.com/v1' };

    const response = await POST(new Request('http://localhost/api/admin/dify/test', {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }));

    expect(response.status).toBe(200);
    expect(requireAdminRequestSessionMock).toHaveBeenCalled();
    expect(testAdminDifyConnectionMock).toHaveBeenCalledWith({
      payload,
      repositories: { repository: true },
    });
  });
});
