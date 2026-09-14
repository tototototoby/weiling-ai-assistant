import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdminRequestSessionMock,
  listAdminGroupsMock,
  createAdminGroupMock,
} = vi.hoisted(() => ({
  requireAdminRequestSessionMock: vi.fn(),
  listAdminGroupsMock: vi.fn(),
  createAdminGroupMock: vi.fn(),
}));

vi.mock('@/lib/admin', () => ({
  requireAdminRequestSession: requireAdminRequestSessionMock,
}));

vi.mock('@/lib/group-admin', () => ({
  createAdminGroup: createAdminGroupMock,
  listAdminGroups: listAdminGroupsMock,
}));

describe('/api/admin/groups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminRequestSessionMock.mockResolvedValue({
      user: { email: 'admin@example.com', id: 'admin_1' },
    });
  });

  it('lists groups after admin auth', async () => {
    listAdminGroupsMock.mockResolvedValue([{ id: 'group_1', name: '市场组' }]);
    const { GET } = await import('../route');

    const response = await GET(new Request('http://localhost/api/admin/groups'));

    expect(response.status).toBe(200);
    expect(requireAdminRequestSessionMock).toHaveBeenCalledOnce();
    expect(listAdminGroupsMock).toHaveBeenCalledOnce();
  });

  it('creates a group after admin auth', async () => {
    createAdminGroupMock.mockResolvedValue({ id: 'group_1', name: '市场组' });
    const { POST } = await import('../route');
    const body = { name: '市场组', leaderEmployeeId: 'employee_1' };

    const response = await POST(new Request('http://localhost/api/admin/groups', {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }));

    expect(response.status).toBe(201);
    expect(createAdminGroupMock).toHaveBeenCalledWith({
      createdByUserId: 'admin_1',
      payload: body,
    });
  });
});
