import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdminRequestSessionMock = vi.fn();
const getRepositoriesMock = vi.fn();
const testAdminRagflowConnectionMock = vi.fn();

vi.mock('@/lib/admin', () => ({
  requireAdminRequestSession: requireAdminRequestSessionMock,
}));

vi.mock('@/lib/repositories', () => ({
  getRepositories: getRepositoriesMock,
}));

vi.mock('@/lib/ragflow-admin', () => ({
  testAdminRagflowConnection: testAdminRagflowConnectionMock,
}));

describe('/api/admin/ragflow/test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminRequestSessionMock.mockResolvedValue({ user: { id: 'admin_1' } });
    getRepositoriesMock.mockReturnValue({ repository: true });
  });

  it('requires an administrator and delegates connection testing server-side', async () => {
    testAdminRagflowConnectionMock.mockResolvedValue({ config: { lastTestStatus: 'success' } });
    const { POST } = await import('../route');
    const payload = {
      apiBaseUrl: 'https://ragflow.example.com/api/v1',
      datasetIds: ['dataset_1'],
    };

    const response = await POST(new Request('http://localhost/api/admin/ragflow/test', {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }));

    expect(response.status).toBe(200);
    expect(requireAdminRequestSessionMock).toHaveBeenCalled();
    expect(testAdminRagflowConnectionMock).toHaveBeenCalledWith({
      payload,
      repositories: { repository: true },
    });
  });

  it('returns a controlled client error for malformed JSON', async () => {
    const { POST } = await import('../route');

    const response = await POST(new Request('http://localhost/api/admin/ragflow/test', {
      body: '{',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'INVALID_JSON_BODY' },
    });
    expect(testAdminRagflowConnectionMock).not.toHaveBeenCalled();
  });
});
