'use client';

import { useState, useTransition } from 'react';
import { Send } from 'lucide-react';
import { EmptyState } from '@/components/layout/empty-state';
import { SectionCard } from '@/components/layout/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { GroupTaskItem, MyTasksPayload } from '@/lib/group-admin';

interface ApiResponse<T> {
  data: T | null;
  error: { message: string } | null;
}

export function MeTasksConsole({ initialPayload }: { initialPayload: MyTasksPayload }) {
  const [tasks, setTasks] = useState(initialPayload.tasks);
  const [bound] = useState(initialPayload.bound);
  const [summary, setSummary] = useState('');
  const [evidenceText, setEvidenceText] = useState('');
  const [submittingTaskId, setSubmittingTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!bound) {
    return (
      <EmptyState
        description="当前账号还没有绑定员工目录条目，请联系管理员完成绑定后再查看任务。"
        title="尚未绑定员工"
      />
    );
  }

  const submitTask = (taskId: string) => {
    if (!summary.trim()) return;
    setError(null);
    setSubmittingTaskId(taskId);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/me/tasks/${taskId}/submit`, {
          body: JSON.stringify({
            summary: summary.trim(),
            evidencePaths: parseEvidence(evidenceText),
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        });
        const payload = (await response.json()) as ApiResponse<GroupTaskItem>;
        if (!response.ok || !payload.data) {
          throw new Error(payload.error?.message ?? '提交失败');
        }
        setTasks((current) => current.map((task) => task.id === taskId ? payload.data! : task));
        setSummary('');
        setEvidenceText('');
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : '提交失败');
      } finally {
        setSubmittingTaskId(null);
      }
    });
  };

  return (
    <div className="grid gap-6">
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      <SectionCard
        contentClassName="grid gap-3"
        description="提交任务后，组长可以在管理台验收或退回修改。"
        title="我的任务"
      >
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
                  {task.groupName}
                  {task.dueAt ? ` · 截止 ${new Date(task.dueAt).toLocaleString('zh-CN')}` : ''}
                </span>
              </div>
            </div>
            {task.description ? <p className="m-0 text-sm leading-6 text-muted-foreground">{task.description}</p> : null}
            {task.acceptanceCriteria ? (
              <p className="m-0 text-sm leading-6"><span className="font-medium">验收标准：</span>{task.acceptanceCriteria}</p>
            ) : null}
            {task.feedback ? <p className="m-0 text-sm leading-6"><span className="font-medium">反馈：</span>{task.feedback}</p> : null}
            {task.submittedSummary ? <p className="m-0 text-sm leading-6"><span className="font-medium">已提交：</span>{task.submittedSummary}</p> : null}

            {task.status === 'pending' || task.status === 'in_progress' || task.status === 'needs_revision' ? (
              <div className="grid gap-3">
                <Label className="grid gap-2 text-sm font-medium">
                  提交说明
                  <textarea
                    className="min-h-24 w-full resize-y rounded-[var(--radius-control)] border border-input bg-[color:var(--surface-elevated)] px-3 py-2 text-sm leading-6"
                    maxLength={4_000}
                    onChange={(event) => setSummary(event.target.value)}
                    value={submittingTaskId === task.id ? summary : ''}
                  />
                </Label>
                <Label className="grid gap-2 text-sm font-medium">
                  证据路径（每行一个）
                  <Input
                    onChange={(event) => setEvidenceText(event.target.value)}
                    placeholder="例如：storage/tasks/demo.png"
                    value={submittingTaskId === task.id ? evidenceText : ''}
                  />
                </Label>
                <div>
                  <Button
                    disabled={pending || !summary.trim()}
                    onClick={() => submitTask(task.id)}
                    type="button"
                  >
                    <Send className="h-4 w-4" />
                    提交任务
                  </Button>
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </SectionCard>
    </div>
  );
}

function parseEvidence(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
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
