'use client';

import { useState, useTransition } from 'react';
import { Save, UsersRound } from 'lucide-react';
import { SectionCard } from '@/components/layout/section-card';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { BroadcastConfigPayload } from '@/lib/admin-configs';
import type { EmployeeOption } from '@/lib/group-admin';
import { getEmployeeDisplayName } from '@/lib/employee-display';

interface ApiResponse<T> {
  data: T | null;
  error: { message: string } | null;
}

interface AdminBroadcastConfigCardProps {
  employees: EmployeeOption[];
  initialConfig: BroadcastConfigPayload;
}

export function AdminBroadcastConfigCard({
  employees,
  initialConfig,
}: AdminBroadcastConfigCardProps) {
  const [config, setConfig] = useState(initialConfig);
  const [enabled, setEnabled] = useState(initialConfig.enabled);
  const [authorized, setAuthorized] = useState<Set<string>>(
    () => new Set(initialConfig.authorizedEmployeeIds),
  );
  const [rateLimitMinutes, setRateLimitMinutes] = useState(initialConfig.rateLimitMinutes);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggleEmployee = (employeeId: string) => {
    setAuthorized((current) => {
      const next = new Set(current);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch('/api/admin/broadcast-config', {
          body: JSON.stringify({
            enabled,
            authorizedEmployeeIds: Array.from(authorized),
            rateLimitMinutes: Number(rateLimitMinutes),
          }),
          headers: { 'content-type': 'application/json' },
          method: 'PUT',
        });
        const payload = (await response.json()) as ApiResponse<BroadcastConfigPayload>;
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? '保存失败');
        setConfig(payload.data);
        setAuthorized(new Set(payload.data.authorizedEmployeeIds));
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : '保存失败');
      }
    });
  };

  return (
    <SectionCard
      contentClassName="grid gap-5"
      description="配置可发起全员/选择群发的授权员工与频控时间。"
      title="群发权限"
    >
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex items-center gap-3 rounded-[var(--radius-control)] border border-[color:var(--border-soft)] px-3 py-3 text-sm font-medium">
          <input
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            type="checkbox"
          />
          启用群发
        </label>
        <Label className="grid gap-2 text-sm font-medium">
          频控间隔（分钟）
          <Input
            min={1}
            onChange={(event) => setRateLimitMinutes(Number(event.target.value))}
            type="number"
            value={rateLimitMinutes}
          />
        </Label>
      </div>
      <div className="grid max-h-64 gap-2 overflow-y-auto rounded-[var(--radius-control)] border border-[color:var(--border-soft)] p-3 md:grid-cols-2">
        {employees.length === 0 ? (
          <p className="m-0 col-span-full py-3 text-sm text-muted-foreground">员工目录为空。</p>
        ) : employees.map((employee) => (
          <label className="flex min-w-0 items-center gap-3 rounded-[var(--radius-control)] px-2 py-2 hover:bg-[color:var(--surface-muted)]" key={employee.id}>
            <input
              checked={authorized.has(employee.id)}
              className="h-4 w-4"
              onChange={() => toggleEmployee(employee.id)}
              type="checkbox"
            />
            <span className="min-w-0">
              <strong className="block truncate text-sm">{getEmployeeDisplayName(employee) ?? employee.id}</strong>
              <span className="block truncate text-xs text-muted-foreground">
                {employee.claimedBotInstanceId ? '已绑定 Bot' : '未绑定 Bot'}
              </span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          已选 {authorized.size} 人 · 版本 {config.revision}
          {config.updatedByEmail ? ` · 更新人 ${config.updatedByEmail}` : ''}
        </span>
        <Button disabled={pending} onClick={save} type="button">
          <Save className="h-4 w-4" />
          保存
        </Button>
      </div>
    </SectionCard>
  );
}
