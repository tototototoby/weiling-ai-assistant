import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdminRequestSessionMock = vi.fn();
const getRepositoriesMock = vi.fn();
const listAdminRagflowMock = vi.fn();
const updateAdminRagflowMock = vi.fn();

vi.mock('@/lib/admin', () => ({
  requireAdminRequestSession: requireAdminRequestSessionMock,
}));

vi.mock('@/lib/repositories', () => ({
  getRepositories: getRepositoriesMock,
}));

vi.mock('@/lib/ragflow-admin', () => ({
  listAdminRagflow: listAdminRagflowMock,
  updateAdminRagflow: updateAdminRagflowMock,
}));

describe('/api/admin/ragflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminRequestSessionMock.mockResolvedValue({
      user: { email: 'admin@example.com', id: 'admin_1' },
    });
    getRepositoriesMock.mockReturnValue({ repository: true });
  });

  it('requires an admin session before listing configuration', async () => {
    listAdminRagflowMock.mockResolvedValue({ config: { apiKeyConfigured: true } });
    const { GET } = await import('../route');

    const response = await GET(new Request('http://localhost/api/admin/ragflow'));

    expect(response.status).toBe(200);
    expect(requireAdminRequestSessionMock).toHaveBeenCalled();
    expect(listAdminRagflowMock).toHaveBeenCalledWith({ repository: true });
  });

  it('passes the authenticated administrator id to configuration updates', async () => {
    updateAdminRagflowMock.mockResolvedValue({ config: { revision: 2 } });
    const { PATCH } = await import('../route');
    const payload = {
      apiBaseUrl: 'https://ragflow.example.com/api/v1',
      apiKey: 'secret',
      datasetIds: ['dataset_1'],
      enabled: true,
      knowledgeBaseName: 'Company RAG',
    };

    const response = await PATCH(new Request('http://localhost/api/admin/ragflow', {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }));

    expect(response.status).toBe(200);
    expect(updateAdminRagflowMock).toHaveBeenCalledWith({
      payload,
      repositories: { repository: true },
      updatedByUserId: 'admin_1',
    });
  });

  it('returns a controlled client error for malformed JSON', async () => {
    const { PATCH } = await import('../route');

    const response = await PATCH(new Request('http://localhost/api/admin/ragflow', {
      body: '{',
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'INVALID_JSON_BODY' },
    });
    expect(updateAdminRagflowMock).not.toHaveBeenCalled();
  });
});
