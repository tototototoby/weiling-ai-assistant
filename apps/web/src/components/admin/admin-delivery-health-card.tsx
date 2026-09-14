'use client';

import { useState, useTransition } from 'react';
import { Activity, Save } from 'lucide-react';
import { SectionCard } from '@/components/layout/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  DeliveryHealthCheckItem,
  DeliveryHealthConfigPayload,
} from '@/lib/admin-configs';

interface ApiResponse<T> {
  data: T | null;
  error: { message: string } | null;
}

interface AdminDeliveryHealthCardProps {
  checks: DeliveryHealthCheckItem[];
  initialConfig: DeliveryHealthConfigPayload;
}

export function AdminDeliveryHealthCard({
  checks,
  initialConfig,
}: AdminDeliveryHealthCardProps) {
  const [config, setConfig] = useState(initialConfig);
  const [enabled, setEnabled] = useState(initialConfig.enabled);
  const [checkTime, setCheckTime] = useState(initialConfig.checkTime);
  const [failedThreshold, setFailedThreshold] = useState(initialConfig.failedThreshold);
  const [stuckHours, setStuckHours] = useState(initialConfig.stuckHours);
  const [alertEmail, setAlertEmail] = useState(initialConfig.alertEmail ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch('/api/admin/delivery-health-config', {
          body: JSON.stringify({
            enabled,
            checkTime,
            failedThreshold: Number(failedThreshold),
            stuckHours: Number(stuckHours),
            alertEmail: alertEmail.trim() || null,
          }),
          headers: { 'content-type': 'application/json' },
          method: 'PUT',
        });
        const payload = (await response.json()) as ApiResponse<DeliveryHealthConfigPayload>;
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? '保存失败');
        setConfig(payload.data);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : '保存失败');
      }
    });
  };

  return (
    <SectionCard
      contentClassName="grid gap-5"
      description="配置每日投递健康检查阈值与告警邮箱。"
      title="投递健康"
    >
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="flex items-center gap-3 rounded-[var(--radius-control)] border border-[color:var(--border-soft)] px-3 py-3 text-sm font-medium">
          <input
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            type="checkbox"
          />
          启用检查
        </label>
        <Label className="grid gap-2 text-sm font-medium">
          检查时间
          <Input
            onChange={(event) => setCheckTime(event.target.value)}
            type="time"
            value={checkTime}
          />
        </Label>
        <Label className="grid gap-2 text-sm font-medium">
          失败阈值
          <Input
            min={1}
            onChange={(event) => setFailedThreshold(Number(event.target.value))}
            type="number"
            value={failedThreshold}
          />
        </Label>
        <Label className="grid gap-2 text-sm font-medium">
          卡住小时数
          <Input
            min={1}
            onChange={(event) => setStuckHours(Number(event.target.value))}
            type="number"
            value={stuckHours}
          />
        </Label>
        <Label className="grid gap-2 text-sm font-medium">
          告警邮箱（可选）
          <Input
            onChange={(event) => setAlertEmail(event.target.value)}
            type="email"
            value={alertEmail}
          />
        </Label>
      </div>
      <div>
        <Button disabled={pending} onClick={save} type="button">
          <Save className="h-4 w-4" />
          保存配置
        </Button>
      </div>

      <div className="grid gap-2">
        <div className="flex items-center gap-2 border-b border-[color:var(--border-soft)] pb-3">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <strong className="text-sm">历史检查记录</strong>
          <Badge variant="neutral">{checks.length}</Badge>
        </div>
        {checks.length === 0 ? (
          <p className="m-0 rounded-[var(--radius-control)] border border-dashed border-[color:var(--border-soft)] bg-[color:var(--surface-muted)] px-4 py-4 text-sm text-muted-foreground">
            暂无检查记录。
          </p>
        ) : (
          <div className="grid gap-2">
            {checks.map((check) => (
              <div className="grid gap-2 rounded-[var(--radius-control)] border border-[color:var(--border-soft)] px-3 py-3" key={check.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-sm">{check.checkDate}</strong>
                  <Badge variant={check.alertSent ? 'warning' : 'success'}>
                    {check.alertSent ? '已告警' : '正常'}
                  </Badge>
                </div>
                <pre className="m-0 max-h-32 overflow-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                  {JSON.stringify(check.summary, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
      <span className="text-xs text-muted-foreground">版本 {config.revision}</span>
    </SectionCard>
  );
}
