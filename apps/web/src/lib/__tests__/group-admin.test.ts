import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getRepositoriesMock } = vi.hoisted(() => ({
  getRepositoriesMock: vi.fn(),
}));

vi.mock('@/lib/repositories', () => ({
  getRepositories: getRepositoriesMock,
}));

import {
  buildTaskNotificationMessage,
  createGroupTask,
  sendTaskNotification,
} from '../group-admin';

describe('group task logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds Chinese notification copy for task lifecycle states', () => {
    expect(buildTaskNotificationMessage({
      status: 'created',
      title: '整理月报',
    })).toContain('新任务');
    expect(buildTaskNotificationMessage({
      feedback: '数据完整',
      status: 'accept',
      title: '整理月报',
    })).toContain('验收通过');
    expect(buildTaskNotificationMessage({
      feedback: '补充来源',
      status: 'needs_revision',
      title: '整理月报',
    })).toContain('需要修改');
  });

  it('creates a task with the group leader as assigner and notifies the bound bot', async () => {
    const repositories = createRepositories();
    getRepositoriesMock.mockReturnValue(repositories);

    const task = await createGroupTask({
      currentEmployeeId: null,
      currentUserId: 'user_1',
      groupId: 'group_1',
      payload: {
        assigneeEmployeeId: 'employee_2',
        title: '整理月报',
        description: '汇总本月数据',
        acceptanceCriteria: '数字准确',
      },
    });

    expect(task.title).toBe('整理月报');
    expect(repositories.groupTasks.create).toHaveBeenCalledWith(expect.objectContaining({
      assignerEmployeeId: 'leader_1',
      assigneeEmployeeId: 'employee_2',
      groupId: 'group_1',
      title: '整理月报',
    }));
    expect(repositories.adminMessageDeliveries.createBatch).toHaveBeenCalledWith([
      expect.objectContaining({
        batchId: 'scheduled:task-notify:task_1',
        botInstanceId: 'bot_2',
        recipientUserId: 'user_2',
        metadata: JSON.stringify({
          channel: 'im',
          taskNotify: true,
          taskId: 'task_1',
          groupId: 'group_1',
        }),
      }),
    ]);
  });

  it('rejects a task when the assignee is not in the group', async () => {
    const repositories = createRepositories({
      assigneeGroupId: 'other_group',
    });
    getRepositoriesMock.mockReturnValue(repositories);

    await expect(createGroupTask({
      currentEmployeeId: null,
      currentUserId: 'user_1',
      groupId: 'group_1',
      payload: {
        assigneeEmployeeId: 'employee_2',
        title: '整理月报',
      },
    })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
    expect(repositories.groupTasks.create).not.toHaveBeenCalled();
  });

  it('skips notification when the assignee has no bound bot', async () => {
    const repositories = createRepositories({
      assigneeBotId: null,
    });

    const sent = await sendTaskNotification({
      assigneeEmployeeId: 'employee_2',
      createdByUserId: 'user_1',
      groupId: 'group_1',
      repositories: repositories as never,
      status: 'created',
      taskId: 'task_1',
      title: '整理月报',
    });

    expect(sent).toBe(false);
    expect(repositories.botInstances.findById).not.toHaveBeenCalled();
    expect(repositories.adminMessageDeliveries.createBatch).not.toHaveBeenCalled();
  });
});

function createRepositories(options: { assigneeBotId?: string | null; assigneeGroupId?: string } = {}) {
  const assigneeBotId = options.assigneeBotId === undefined ? 'bot_2' : options.assigneeBotId;
  const assigneeGroupId = options.assigneeGroupId ?? 'group_1';
  return {
    adminMessageDeliveries: {
      createBatch: vi.fn().mockResolvedValue([]),
    },
    botDailyActivity: {
      sumRange: vi.fn().mockResolvedValue([]),
    },
    botInstances: {
      findById: vi.fn().mockResolvedValue(assigneeBotId
        ? { id: assigneeBotId, ownerUserId: 'user_2' }
        : null),
    },
    employeeDirectory: {
      findById: vi.fn().mockImplementation(async (id: string) => ({
        id,
        nickname: null,
        legalName: id === 'employee_2' ? '组员' : '组长',
        companyEmail: null,
        enabled: true,
        groupId: id === 'employee_2' ? assigneeGroupId : null,
        claimedBotInstanceId: id === 'employee_2' ? assigneeBotId : null,
        claimedByUserId: null,
      })),
      listAll: vi.fn().mockResolvedValue([]),
    },
    employeeGroups: {
      findById: vi.fn().mockResolvedValue({
        id: 'group_1',
        name: '市场组',
        leaderEmployeeId: 'leader_1',
      }),
      listMemberEntries: vi.fn().mockResolvedValue([{
        id: 'employee_2',
        nickname: null,
        legalName: '组员',
        enabled: true,
        groupId: 'group_1',
      }]),
    },
    groupTasks: {
      create: vi.fn().mockResolvedValue({
        id: 'task_1',
        groupId: 'group_1',
        assignerEmployeeId: 'leader_1',
        assigneeEmployeeId: 'employee_2',
        title: '整理月报',
        description: '',
        acceptanceCriteria: '',
        status: 'pending',
        dueAt: null,
        submittedAt: null,
        submittedSummary: null,
        submittedEvidenceJson: null,
        acceptedAt: null,
        feedback: null,
        createdAt: new Date('2026-08-24T01:00:00.000Z'),
        updatedAt: new Date('2026-08-24T01:00:00.000Z'),
      }),
    },
  };
}
