'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { ArrowRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { SectionCard } from '@/components/layout/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AdminGroupItem, EmployeeOption } from '@/lib/group-admin';
import { getEmployeeDisplayName } from '@/lib/employee-display';

interface ApiResponse<T> {
  data: T | null;
  error: { message: string } | null;
}

interface AdminGroupsConsoleProps {
  employees: EmployeeOption[];
  initialGroups: AdminGroupItem[];
}

export function AdminGroupsConsole({
  employees,
  initialGroups,
}: AdminGroupsConsoleProps) {
  const [groups, setGroups] = useState(initialGroups);
  const [name, setName] = useState('');
  const [leaderEmployeeId, setLeaderEmployeeId] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editLeaderEmployeeId, setEditLeaderEmployeeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const createGroup = () => {
    setError(null);
    startTransition(async () => {
      try {
        const payload = {
          name: name.trim(),
          leaderEmployeeId: leaderEmployeeId || null,
        };
        const data = await request<AdminGroupItem>('/api/admin/groups', {
          body: JSON.stringify(payload),
          method: 'POST',
        });
        setGroups((current) => [...current, data].sort((a, b) => a.name.localeCompare(b.name)));
        setName('');
        setLeaderEmployeeId('');
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : '创建分组失败');
      }
    });
  };

  const saveGroup = (groupId: string) => {
    setError(null);
    startTransition(async () => {
      try {
        const data = await request<AdminGroupItem>(`/api/admin/groups/${groupId}`, {
          body: JSON.stringify({
            name: editName.trim(),
            leaderEmployeeId: editLeaderEmployeeId || null,
          }),
          method: 'PATCH',
        });
        setGroups((current) => current.map((group) => group.id === groupId ? data : group));
        setEditingId(null);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : '保存分组失败');
      }
    });
  };

  const deleteGroup = (groupId: string) => {
    if (!window.confirm('确认删除该分组？组内成员会变为未分配。')) return;
    setError(null);
    startTransition(async () => {
      try {
        await request<{ id: string }>(`/api/admin/groups/${groupId}`, { method: 'DELETE' });
        setGroups((current) => current.filter((group) => group.id !== groupId));
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : '删除分组失败');
      }
    });
  };

  return (
    <div className="grid gap-6">
      <SectionCard
        contentClassName="grid gap-5"
        description="创建小组，并可指定一名组长。组长可发布、验收和退回组内任务。"
        title="新建分组"
      >
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Label className="grid gap-2 text-sm font-medium">
            分组名称
            <Input
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：市场组"
              value={name}
            />
          </Label>
          <Label className="grid gap-2 text-sm font-medium">
            组长（可选）
            <select
              className="h-11 rounded-[var(--radius-control)] border border-input bg-[color:var(--surface-elevated)] px-3 text-sm"
              onChange={(event) => setLeaderEmployeeId(event.target.value)}
              value={leaderEmployeeId}
            >
              <option value="">暂不设置</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {getEmployeeDisplayName(employee) ?? employee.id}
                </option>
              ))}
            </select>
          </Label>
          <Button disabled={pending || !name.trim()} onClick={createGroup} type="button">
            <Plus className="h-4 w-4" />
            创建
          </Button>
        </div>
      </SectionCard>

      {error ? <ErrorNotice>{error}</ErrorNotice> : null}

      <SectionCard
        contentClassName="grid gap-3"
        description="分组列表会显示成员数量与组长姓名。"
        title="已有分组"
      >
        {groups.length === 0 ? (
          <p className="m-0 rounded-[var(--radius-panel)] border border-dashed border-[color:var(--border-soft)] bg-[color:var(--surface-muted)] px-4 py-6 text-sm text-muted-foreground">
            还没有分组。
          </p>
        ) : groups.map((group) => (
          <article
            className="grid gap-4 rounded-[var(--radius-panel)] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 md:grid-cols-[minmax(0,1fr)_auto]"
            key={group.id}
          >
            {editingId === group.id ? (
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <Input
                  aria-label="分组名称"
                  maxLength={100}
                  onChange={(event) => setEditName(event.target.value)}
                  value={editName}
                />
                <select
                  aria-label="组长"
                  className="h-11 rounded-[var(--radius-control)] border border-input bg-[color:var(--surface-elevated)] px-3 text-sm"
                  onChange={(event) => setEditLeaderEmployeeId(event.target.value)}
                  value={editLeaderEmployeeId}
                >
                  <option value="">暂不设置</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {getEmployeeDisplayName(employee) ?? employee.id}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <Button disabled={pending} onClick={() => saveGroup(group.id)} size="sm" type="button">
                    保存
                  </Button>
                  <Button onClick={() => setEditingId(null)} size="sm" type="button" variant="outline">
                    取消
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid min-w-0 gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="truncate text-base font-semibold">{group.name}</strong>
                  <Badge variant="neutral">{group.memberCount} 名成员</Badge>
                  {group.leaderName ? <Badge variant="success">组长：{group.leaderName}</Badge> : null}
                </div>
                <span className="text-sm text-muted-foreground">
                  更新于 {new Date(group.updatedAt).toLocaleString('zh-CN')}
                </span>
              </div>
            )}
            <div className="flex flex-wrap items-start gap-2 md:justify-end">
              {editingId !== group.id ? (
                <>
                  <Button
                    onClick={() => {
                      setEditingId(group.id);
                      setEditName(group.name);
                      setEditLeaderEmployeeId(group.leaderEmployeeId ?? '');
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Pencil className="h-4 w-4" />
                    编辑
                  </Button>
                  <Button asChild size="sm" type="button" variant="outline">
                    <Link href={`/admin/groups/${group.id}`}>
                      管理成员与任务
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button
                    disabled={pending}
                    onClick={() => deleteGroup(group.id)}
                    size="sm"
                    type="button"
                    variant="destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                    删除
                  </Button>
                </>
              ) : null}
            </div>
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
