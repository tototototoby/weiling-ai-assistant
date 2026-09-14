import { beforeEach, describe, expect, it, vi } from 'vitest';

const deleteEmployeeDirectoryEntryMock = vi.fn();
const requireAdminRequestSessionMock = vi.fn();

vi.mock('@/lib/admin', () => ({
  requireAdminRequestSession: requireAdminRequestSessionMock,
}));

vi.mock('@/lib/employee-onboarding', () => ({
  deleteEmployeeDirectoryEntry: deleteEmployeeDirectoryEntryMock,
  updateEmployeeDirectoryEntry: vi.fn(),
}));

describe('/api/admin/employees/[id] route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('deletes an employee directory record for administrators', async () => {
    requireAdminRequestSessionMock.mockResolvedValue({
      user: { email: 'admin@example.com', id: 'admin_1' },
    });
    deleteEmployeeDirectoryEntryMock.mockResolvedValue({ id: 'employee_1' });

    const { DELETE } = await import('../route');
    const response = await DELETE(new Request('http://localhost/api/admin/employees/employee_1', {
      method: 'DELETE',
    }), {
      params: Promise.resolve({ id: 'employee_1' }),
    });

    expect(deleteEmployeeDirectoryEntryMock).toHaveBeenCalledWith('employee_1');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { id: 'employee_1' },
      error: null,
    });
  });

  it('does not call the service when the request is not an administrator request', async () => {
    const { ApiError } = await import('@/lib/api-error');
    requireAdminRequestSessionMock.mockRejectedValue(new ApiError({
      code: 'FORBIDDEN',
      message: 'Administrator access is required.',
      status: 403,
    }));

    const { DELETE } = await import('../route');
    const response = await DELETE(new Request('http://localhost/api/admin/employees/employee_1', {
      method: 'DELETE',
    }), {
      params: Promise.resolve({ id: 'employee_1' }),
    });

    expect(deleteEmployeeDirectoryEntryMock).not.toHaveBeenCalled();
    expect(response.status).toBe(403);
  });
});
