import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  listMyTasksMock,
  requireRequestSessionMock,
  submitMyTaskMock,
} = vi.hoisted(() => ({
  listMyTasksMock: vi.fn(),
  requireRequestSessionMock: vi.fn(),
  submitMyTaskMock: vi.fn(),
}));

vi.mock('@/lib/session', () => ({
  requireRequestSession: requireRequestSessionMock,
}));

vi.mock('@/lib/group-admin', () => ({
  listMyTasks: listMyTasksMock,
  submitMyTask: submitMyTaskMock,
}));

describe('/api/me/tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRequestSessionMock.mockResolvedValue({
      user: { id: 'employee_user_1' },
    });
  });

  it('returns the current employee task list', async () => {
    listMyTasksMock.mockResolvedValue({ bound: true, tasks: [] });
    const { GET } = await import('../route');

    const response = await GET(new Request('http://localhost/api/me/tasks'));

    expect(response.status).toBe(200);
    expect(listMyTasksMock).toHaveBeenCalledWith('employee_user_1');
  });

  it('submits a task owned by the current employee', async () => {
    submitMyTaskMock.mockResolvedValue({ id: 'task_1', status: 'submitted' });
    const { POST } = await import('../[taskId]/submit/route');
    const payload = { summary: '已完成', evidencePaths: ['demo.png'] };

    const response = await POST(new Request('http://localhost/api/me/tasks/task_1/submit', {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }), { params: Promise.resolve({ taskId: 'task_1' }) } as never);

    expect(response.status).toBe(200);
    expect(submitMyTaskMock).toHaveBeenCalledWith({
      payload,
      taskId: 'task_1',
      userId: 'employee_user_1',
    });
  });
});
