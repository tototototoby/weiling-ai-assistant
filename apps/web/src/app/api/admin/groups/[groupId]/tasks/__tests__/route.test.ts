import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createGroupTaskMock,
  listGroupTasksMock,
  requireGroupManagerMock,
  updateGroupTaskMock,
} = vi.hoisted(() => ({
  createGroupTaskMock: vi.fn(),
  listGroupTasksMock: vi.fn(),
  requireGroupManagerMock: vi.fn(),
  updateGroupTaskMock: vi.fn(),
}));

vi.mock('@/lib/group-admin', () => ({
  createGroupTask: createGroupTaskMock,
  listGroupTasks: listGroupTasksMock,
  requireGroupManager: requireGroupManagerMock,
  updateGroupTask: updateGroupTaskMock,
}));

describe('/api/admin/groups/[groupId]/tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireGroupManagerMock.mockResolvedValue({
      employeeId: 'leader_1',
      session: { user: { id: 'user_1' } },
    });
  });

  it('lists tasks for a group manager', async () => {
    listGroupTasksMock.mockResolvedValue([{ id: 'task_1', title: '整理月报' }]);
    const { GET } = await import('../route');

    const response = await GET(new Request('http://localhost/api/admin/groups/group_1/tasks'), {
      params: Promise.resolve({ groupId: 'group_1' }),
    } as unknown as { params: Promise<{ groupId: string }> });

    expect(response.status).toBe(200);
    expect(requireGroupManagerMock).toHaveBeenCalledWith(expect.any(Request), 'group_1');
    expect(listGroupTasksMock).toHaveBeenCalledWith('group_1');
  });

  it('creates a task for a group manager', async () => {
    createGroupTaskMock.mockResolvedValue({ id: 'task_1', title: '整理月报' });
    const { POST } = await import('../route');
    const payload = { assigneeEmployeeId: 'employee_2', title: '整理月报' };

    const response = await POST(new Request('http://localhost/api/admin/groups/group_1/tasks', {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }), { params: Promise.resolve({ groupId: 'group_1' }) } as never);

    expect(response.status).toBe(201);
    expect(createGroupTaskMock).toHaveBeenCalledWith({
      currentEmployeeId: 'leader_1',
      currentUserId: 'user_1',
      groupId: 'group_1',
      payload,
    });
  });

  it('reviews a task through accept or needs_revision', async () => {
    updateGroupTaskMock.mockResolvedValue({ id: 'task_1', status: 'accepted' });
    const { PATCH } = await import('../[taskId]/route');
    const payload = { action: 'accept', feedback: '数据完整' };

    const response = await PATCH(new Request('http://localhost/api/admin/groups/group_1/tasks/task_1', {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }), {
      params: Promise.resolve({ groupId: 'group_1', taskId: 'task_1' }),
    } as never);

    expect(response.status).toBe(200);
    expect(updateGroupTaskMock).toHaveBeenCalledWith({
      groupId: 'group_1',
      payload,
      taskId: 'task_1',
      updatedByUserId: 'user_1',
    });
  });
});
