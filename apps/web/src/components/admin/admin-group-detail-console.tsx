'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { ArrowLeft, Check, Plus, RotateCcw, Save, UserRound } from 'lucide-react';
import { SectionCard } from '@/components/layout/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  AdminGroupItem,
  EmployeeOption,
  GroupTaskItem,
} from '@/lib/group-admin';
import { getEmployeeDisplayName } from '@/lib/employee-display';

interface ApiResponse<T> {
  data: T | null;
  error: { message: string } | null;
}

interface AdminGroupDetailConsoleProps {
  initialGroup: AdminGroupItem;
  initialMembers: EmployeeOption[];
  initialTasks: GroupTaskItem[];
  initialUnassigned: EmployeeOption[];
}

export function AdminGroupDetailConsole({
  initialGroup,
  initialMembers,
  initialTasks,
  initialUnassigned,
}: AdminGroupDetailConsoleProps) {
  const [group, setGroup] = useState(initialGroup);
  const [members, setMembers] = useState(initialMembers);
  const [unassigned, setUnassigned] = useState(initialUnassigned);
  const [tasks, setTasks] = useState(initialTasks);
  const [groupName, setGroupName] = useState(initialGroup.name);
  const [leaderEmployeeId, setLeaderEmployeeId] = useState(initialGroup.leaderEmployeeId ?? '');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [taskDraft, setTaskDraft] = useState({
    assigneeEmployeeId: '',
    title: '',
    description: '',
    acceptanceCriteria: '',
    dueAt: '',
  });
  const [feedbackByTask, setFeedbackByTask] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const saveGroup = () => {
    setError(null);
    startTransition(async () => {
      try {
        const data = await request<AdminGroupItem>(`/api/admin/groups/${group.id}`, {
          body: JSON.stringify({
            name: groupName.trim(),
            leaderEmployeeId: leaderEmployeeId || null,
          }),
          method: 'PATCH',
        });
        setGroup(data);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : '保存分组失败');
      }
    });
  };

  const addMembers = () => {
    if (!selectedEmployeeId) return;
    setError(null);
    startTransition(async () => {
      try {
        const data = await request<EmployeeOption[]>(`/api/admin/groups/${group.id}/members`, {
          body: JSON.stringify({ add: [selectedEmployeeId] }),
          method: 'PUT',
        });
        setMembers(data);
        setUnassigned((current) => current.filter((employee) => employee.id !== selectedEmployeeId));
        setSelectedEmployeeId('');
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : '添加成员失败');
      }
    });
  };

  const removeMember = (employeeId: string) => {
    if (!window.confirm('确认将该成员移出分组？')) return;
    setError(null);
    startTransition(async () => {
      try {
        const data = await request<EmployeeOption[]>(`/api/admin/groups/${group.id}/members`, {
          body: JSON.stringify({ remove: [employeeId] }),
          method: 'PUT',
        });
        const removed = members.find((member) => member.id === employeeId);
        setMembers(data);
        if (removed) setUnassigned((current) => [...current, removed].sort((a, b) => (
          (getEmployeeDisplayName(a) ?? '').localeCompare(getEmployeeDisplayName(b) ?? '')
        )));
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : '移除成员失败');
      }
    });
  };

  const createTask = () => {
    if (!taskDraft.assigneeEmployeeId || !taskDraft.title.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        const data = await request<GroupTaskItem>(`/api/admin/groups/${group.id}/tasks`, {
          body: JSON.stringify({
            ...taskDraft,
            dueAt: taskDraft.dueAt ? new Date(taskDraft.dueAt).toISOString() : undefined,
            title: taskDraft.title.trim(),
            description: taskDraft.description.trim(),
            acceptanceCriteria: taskDraft.acceptanceCriteria.trim(),
          }),
          method: 'POST',
        });
        setTasks((current) => [data, ...current]);
        setTaskDraft({
          assigneeEmployeeId: '',
          title: '',
          description: '',
          acceptanceCriteria: '',
          dueAt: '',
        });
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : '创建任务失败');
      }
    });
  };

  const reviewTask = (taskId: string, action: 'accept' | 'needs_revision') => {
    setError(null);
    startTransition(async () => {
      try {
        const data = await request<GroupTaskItem>(`/api/admin/groups/${group.id}/tasks/${taskId}`, {
          body: JSON.stringify({
            action,
            feedback: feedbackByTask[taskId] || null,
          }),
          method: 'PATCH',
        });
        setTasks((current) => current.map((task) => task.id === taskId ? data : task));
        setFeedbackByTask((current) => ({ ...current, [taskId]: '' }));
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : '任务操作失败');
      }
    });
  };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild size="sm" type="button" variant="outline">
          <Link href="/admin/groups">
            <ArrowLeft className="h-4 w-4" />
            返回分组
          </Link>
        </Button>
      </div>

      {error ? <ErrorNotice>{error}</ErrorNotice> : null}

      <SectionCard
        contentClassName="grid gap-5"
        description="修改分组名称或组长。移除组长不会自动解散分组。"
        title="分组信息"
      >
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Label className="grid gap-2 text-sm font-medium">
            分组名称
            <Input
              maxLength={100}
              onChange={(event) => setGroupName(event.target.value)}
              value={groupName}
            />
          </Label>
          <Label className="grid gap-2 text-sm font-medium">
            组长
            <select
              className="h-11 rounded-[var(--radius-control)] border border-input bg-[color:var(--surface-elevated)] px-3 text-sm"
              onChange={(event) => setLeaderEmployeeId(event.target.value)}
              value={leaderEmployeeId}
            >
              <option value="">暂不设置</option>
              {[...members, ...unassigned].map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {getEmployeeDisplayName(employee) ?? employee.id}
                </option>
              ))}
            </select>
          </Label>
          <Button disabled={pending} onClick={saveGroup} type="button">
            <Save className="h-4 w-4" />
            保存
          </Button>
        </div>
      </SectionCard>

      <SectionCard
        contentClassName="grid gap-5"
        description="成员选择器只列出未分配且启用的员工。"
        title="成员管理"
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <select
            aria-label="选择未分配员工"
            className="h-11 rounded-[var(--radius-control)] border border-input bg-[color:var(--surface-elevated)] px-3 text-sm"
            onChange={(event) => setSelectedEmployeeId(event.target.value)}
            value={selectedEmployeeId}
          >
            <option value="">选择未分配员工</option>
            {unassigned.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {getEmployeeDisplayName(employee) ?? employee.id}
              </option>
            ))}
          </select>
          <Button disabled={pending || !selectedEmployeeId} onClick={addMembers} type="button">
            <UserRound className="h-4 w-4" />
            添加成员
          </Button>
        </div>
        {members.length === 0 ? (
          <p className="m-0 rounded-[var(--radius-panel)] border border-dashed border-[color:var(--border-soft)] bg-[color:var(--surface-muted)] px-4 py-5 text-sm text-muted-foreground">
            暂无成员。
          </p>
        ) : (
          <div className="grid gap-2">
            {members.map((member) => (
              <div
                className="grid gap-3 rounded-[var(--radius-control)] border border-[color:var(--border-soft)] px-3 py-3 md:grid-cols-[minmax(0,1fr)_auto]"
                key={member.id}
              >
                <div className="grid min-w-0 gap-1">
                  <strong className="truncate text-sm">{getEmployeeDisplayName(member) ?? member.id}</strong>
                  <span className="truncate text-xs text-muted-foreground">
                    {member.claimedBotInstanceId ? '已绑定 Bot' : '未绑定 Bot'}
                    {member.companyEmail ? ` · ${member.companyEmail}` : ''}
                  </span>
                </div>
                <Button
                  disabled={pending}
                  onClick={() => removeMember(member.id)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  移除
                </Button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        contentClassName="grid gap-5"
        description="创建任务时会向被指派员工的 Bot 发送通知；无绑定 Bot 的员工会跳过通知。"
        title="任务闭环"
      >
        <div className="grid gap-4 rounded-[var(--radius-panel)] border border-[color:var(--border-soft)] p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Label className="grid gap-2 text-sm font-medium">
              指派员工
              <select
                className="h-11 rounded-[var(--radius-control)] border border-input bg-[color:var(--surface-elevated)] px-3 text-sm"
                onChange={(event) => setTaskDraft((current) => ({ ...current, assigneeEmployeeId: event.target.value }))}
                value={taskDraft.assigneeEmployeeId}
              >
                <option value="">选择组内成员</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {getEmployeeDisplayName(member) ?? member.id}
                  </option>
                ))}
              </select>
            </Label>
            <Label className="grid gap-2 text-sm font-medium">
              截止时间
              <Input
                onChange={(event) => setTaskDraft((current) => ({ ...current, dueAt: event.target.value }))}
                type="datetime-local"
                value={taskDraft.dueAt}
              />
            </Label>
          </div>
          <Label className="grid gap-2 text-sm font-medium">
            任务标题
            <Input
              maxLength={200}
              onChange={(event) => setTaskDraft((current) => ({ ...current, title: event.target.value }))}
              value={taskDraft.title}
            />
          </Label>
          <Label className="grid gap-2 text-sm font-medium">
            任务说明
            <textarea
              className="min-h-24 w-full resize-y rounded-[var(--radius-control)] border border-input bg-[color:var(--surface-elevated)] px-3 py-2 text-sm leading-6"
              maxLength={4_000}
              onChange={(event) => setTaskDraft((current) => ({ ...current, description: event.target.value }))}
              value={taskDraft.description}
            />
          </Label>
          <Label className="grid gap-2 text-sm font-medium">
            验收标准
            <textarea
              className="min-h-24 w-full resize-y rounded-[var(--radius-control)] border border-input bg-[color:var(--surface-elevated)] px-3 py-2 text-sm leading-6"
              maxLength={4_000}
              onChange={(event) => setTaskDraft((current) => ({ ...current, acceptanceCriteria: event.target.value }))}
              value={taskDraft.acceptanceCriteria}
            />
          </Label>
          <div>
            <Button
              disabled={pending || !taskDraft.title.trim() || !taskDraft.assigneeEmployeeId}
              onClick={createTask}
              type="button"
            >
              <Plus className="h-4 w-4" />
              创建任务
            </Button>
          </div>
        </div>

        {tasks.length === 0 ? (
          <p className="m-0 rounded-[var(--radius-panel)] border border-dashed border-[color:var(--border-soft)] bg-[color:var(--surface-muted)] px-4 py-6 text-sm text-muted-foreground">
            暂无任务。
          </p>
        ) : tasks.map((task) => (
          <article
            className="grid gap-4 rounded-[var(--radius-panel)] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4"
            key={task.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid min-w-0 gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-base">{task.title}</strong>
                  <Badge variant={task.status === 'accepted' ? 'success' : task.status === 'needs_revision' ? 'warning' : task.status === 'submitted' ? 'default' : 'neutral'}>
                    {taskStatusLabel(task.status)}
                  </Badge>
                </div>
                <span className="text-sm text-muted-foreground">
                  指派给 {task.assigneeName ?? task.assigneeEmployeeId}
                  {task.dueAt ? ` · 截止 ${new Date(task.dueAt).toLocaleString('zh-CN')}` : ''}
                </span>
              </div>
              {task.status === 'submitted' || task.status === 'needs_revision' ? (
                <div className="grid w-full gap-2 md:w-80">
                  <textarea
                    aria-label="任务反馈"
                    className="min-h-20 w-full resize-y rounded-[var(--radius-control)] border border-input bg-[color:var(--surface-elevated)] px-3 py-2 text-sm leading-6"
                    maxLength={2_000}
                    onChange={(event) => setFeedbackByTask((current) => ({ ...current, [task.id]: event.target.value }))}
                    placeholder="填写验收反馈（可选）"
                    value={feedbackByTask[task.id] ?? ''}
                  />
                  <div className="flex gap-2">
                    <Button
                      disabled={pending}
                      onClick={() => reviewTask(task.id, 'accept')}
                      size="sm"
                      type="button"
                    >
                      <Check className="h-4 w-4" />
                      验收通过
                    </Button>
                    <Button
                      disabled={pending}
                      onClick={() => reviewTask(task.id, 'needs_revision')}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <RotateCcw className="h-4 w-4" />
                      退回修改
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
            {task.description ? <p className="m-0 text-sm leading-6 text-muted-foreground">{task.description}</p> : null}
            {task.acceptanceCriteria ? (
              <p className="m-0 text-sm leading-6">
                <span className="font-medium">验收标准：</span>
                {task.acceptanceCriteria}
              </p>
            ) : null}
            {task.submittedSummary ? (
              <p className="m-0 text-sm leading-6">
                <span className="font-medium">提交说明：</span>
                {task.submittedSummary}
              </p>
            ) : null}
            {task.submittedEvidence.length > 0 ? (
              <div className="flex flex-wrap gap-2 text-sm">
                {task.submittedEvidence.map((path) => <Badge key={path} variant="outline">{path}</Badge>)}
              </div>
            ) : null}
            {task.feedback ? <p className="m-0 text-sm leading-6"><span className="font-medium">反馈：</span>{task.feedback}</p> : null}
          </article>
        ))}
      </SectionCard>
    </div>
  );
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init.headers,
    },
  });
  const payload = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !payload.data) {
    throw new Error(payload.error?.message ?? '请求失败');
  }
  return payload.data;
}

function taskStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: '待处理',
    in_progress: '进行中',
    submitted: '待验收',
    accepted: '已验收',
    needs_revision: '需修改',
    archived: '已归档',
  };
  return labels[status] ?? status;
}
