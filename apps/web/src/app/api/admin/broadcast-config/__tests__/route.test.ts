import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getBroadcastConfigMock,
  requireAdminRequestSessionMock,
  updateBroadcastConfigMock,
} = vi.hoisted(() => ({
  getBroadcastConfigMock: vi.fn(),
  requireAdminRequestSessionMock: vi.fn(),
  updateBroadcastConfigMock: vi.fn(),
}));

vi.mock('@/lib/admin', () => ({
  requireAdminRequestSession: requireAdminRequestSessionMock,
}));

vi.mock('@/lib/admin-configs', () => ({
  getBroadcastConfig: getBroadcastConfigMock,
  updateBroadcastConfig: updateBroadcastConfigMock,
}));

describe('/api/admin/broadcast-config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminRequestSessionMock.mockResolvedValue({
      user: { email: 'admin@example.com', id: 'admin_1' },
    });
  });

  it('returns the broadcast config without exposing a secret', async () => {
    getBroadcastConfigMock.mockResolvedValue({
      enabled: true,
      authorizedEmployeeIds: ['employee_1'],
      rateLimitMinutes: 10,
    });
    const { GET } = await import('../route');

    const response = await GET(new Request('http://localhost/api/admin/broadcast-config'));

    expect(response.status).toBe(200);
    expect(getBroadcastConfigMock).toHaveBeenCalledOnce();
  });

  it('updates the broadcast config with the current user id', async () => {
    updateBroadcastConfigMock.mockResolvedValue({ enabled: false });
    const { PUT } = await import('../route');
    const payload = {
      enabled: false,
      authorizedEmployeeIds: ['employee_1'],
      rateLimitMinutes: 20,
    };

    const response = await PUT(new Request('http://localhost/api/admin/broadcast-config', {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    }));

    expect(response.status).toBe(200);
    expect(updateBroadcastConfigMock).toHaveBeenCalledWith({
      payload,
      updatedByUserId: 'admin_1',
    });
  });
});
