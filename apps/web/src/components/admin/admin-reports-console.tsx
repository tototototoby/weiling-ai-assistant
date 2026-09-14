'use client';

import { useState, useTransition } from 'react';
import { Activity, AlertTriangle, BarChart3, Mail } from 'lucide-react';
import { SectionCard } from '@/components/layout/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import type { AdminReportsPayload, ReportDays } from '@/lib/reports';

interface ApiResponse<T> {
  data: T | null;
  error: { message: string } | null;
}

export function AdminReportsConsole({ initialData }: { initialData: AdminReportsPayload }) {
  const [data, setData] = useState(initialData);
  const [days, setDays] = useState<ReportDays>(initialData.days);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const loadDays = (nextDays: ReportDays) => {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/admin/reports?days=${nextDays}`);
        const payload = (await response.json()) as ApiResponse<AdminReportsPayload>;
        if (!response.ok || !payload.data) {
          throw new Error(payload.error?.message ?? '加载报表失败');
        }
        setData(payload.data);
        setDays(nextDays);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : '加载报表失败');
      }
    });
  };

  const maxInbound = Math.max(1, ...data.activity.map((item) => item.inbound));
  const maxOutbound = Math.max(1, ...data.activity.map((item) => item.outbound));

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex w-fit rounded-[var(--radius-control)] border border-[color:var(--border-soft)] bg-[color:var(--surface-muted)] p-1">
          <Button
            disabled={pending}
            onClick={() => loadDays(7)}
            size="sm"
            type="button"
            variant={days === 7 ? 'default' : 'ghost'}
          >
            近 7 天
          </Button>
          <Button
            disabled={pending}
            onClick={() => loadDays(30)}
            size="sm"
            type="button"
            variant={days === 30 ? 'default' : 'ghost'}
          >
            近 30 天
          </Button>
        </div>
        <span className="text-sm text-muted-foreground">统计范围为最近 {days} 天（含今天）。</span>
      </div>

      {error ? <ErrorNotice>{error}</ErrorNotice> : null}

      <SectionCard
        contentClassName="grid gap-4"
        description="按 Bot 汇总入站与出站消息量。"
        title="Bot 活跃"
      >
        {data.activity.length === 0 ? (
          <p className="m-0 rounded-[var(--radius-panel)] border border-dashed border-[color:var(--border-soft)] bg-[color:var(--surface-muted)] px-4 py-6 text-sm text-muted-foreground">
            暂无 Bot 数据。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[color:var(--border-soft)] text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  <th className="py-3 pr-4 font-semibold">Bot</th>
                  <th className="py-3 pr-4 font-semibold">归属</th>
                  <th className="py-3 pr-4 font-semibold">入站</th>
                  <th className="py-3 font-semibold">出站</th>
                </tr>
              </thead>
              <tbody>
                {data.activity.map((item) => (
                  <tr className="border-b border-[color:var(--border-soft)] last:border-b-0" key={item.botInstanceId}>
                    <td className="py-3 pr-4">
                      <strong className="block truncate">{item.botName}</strong>
                      <span className="text-xs text-muted-foreground">{item.botInstanceId}</span>
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">{item.ownerEmail ?? item.ownerUserId}</td>
                    <td className="py-3 pr-4">
                      <div className="grid w-36 gap-1">
                        <div className="flex justify-between text-xs"><span>{item.inbound}</span><span>消息</span></div>
                        <div className="h-2 overflow-hidden rounded-full bg-[color:var(--surface-muted)]">
                          <div className="h-full rounded-full bg-[color:var(--accent-strong)]" style={{ width: `${Math.round((item.inbound / maxInbound) * 100)}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="py-3">
                      <div className="grid w-36 gap-1">
                        <div className="flex justify-between text-xs"><span>{item.outbound}</span><span>消息</span></div>
                        <div className="h-2 overflow-hidden rounded-full bg-[color:var(--surface-muted)]">
                          <div className="h-full rounded-full bg-[color:var(--status-success)]" style={{ width: `${Math.round((item.outbound / maxOutbound) * 100)}%` }} />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        contentClassName="grid gap-6"
        description="展示主动消息队列的状态分布与最近失败记录。"
        title="投递状态"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Object.entries(data.delivery.totalsByStatus).map(([status, count]) => (
            <dl className="rounded-[var(--radius-panel)] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4" key={status}>
              <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                <Activity className="h-4 w-4" />
                {statusLabel(status)}
              </dt>
              <dd className="m-0 mt-2 text-2xl font-semibold">{count}</dd>
            </dl>
          ))}
        </div>

        {data.delivery.recentFailures.length === 0 ? (
          <p className="m-0 rounded-[var(--radius-panel)] border border-dashed border-[color:var(--border-soft)] bg-[color:var(--surface-muted)] px-4 py-5 text-sm text-muted-foreground">
            没有失败或等待用户的投递记录。
          </p>
        ) : (
          <div className="grid gap-2">
            {data.delivery.recentFailures.map((item) => (
              <div className="grid gap-2 rounded-[var(--radius-control)] border border-[color:var(--status-danger)]/20 bg-[color:var(--status-danger-soft)] px-4 py-3" key={item.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-sm">{item.botName}</strong>
                  <Badge variant="danger">{item.status === 'waiting_for_user' ? '等待用户' : '失败'}</Badge>
                </div>
                <p className="m-0 text-sm text-muted-foreground">{item.message}</p>
                <p className="m-0 text-xs text-muted-foreground">{item.lastError ?? '无错误详情'}</p>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        contentClassName="grid gap-4"
        description="企业邮箱投递状态来自最近 1000 条记录。"
        title="邮件投递"
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryMetric icon={<Mail className="h-4 w-4" />} label="总数" value={data.email.total} />
          <SummaryMetric icon={<BarChart3 className="h-4 w-4" />} label="成功" value={data.email.sent} />
          <SummaryMetric icon={<AlertTriangle className="h-4 w-4" />} label="失败" value={data.email.failed} />
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-[color:var(--surface-muted)]">
          <div
            className="h-full rounded-full bg-[color:var(--status-success)]"
            style={{ width: `${data.email.total > 0 ? Math.round((data.email.sent / data.email.total) * 100) : 0}%` }}
          />
        </div>
      </SectionCard>
    </div>
  );
}

function SummaryMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <dl className="rounded-[var(--radius-panel)] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4">
      <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="m-0 mt-2 text-2xl font-semibold">{value}</dd>
    </dl>
  );
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: '待发送',
    delivering: '发送中',
    sent: '已发送',
    failed: '失败',
    waiting_for_user: '等待用户',
  };
  return labels[status] ?? status;
}
