'use client';

import { useState, useTransition } from 'react';
import { Image, Save } from 'lucide-react';
import { SectionCard } from '@/components/layout/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ImagegenConfigPayload } from '@/lib/admin-configs';

interface ApiResponse<T> {
  data: T | null;
  error: { message: string } | null;
}

export function AdminImagegenConfigCard({ initialConfig }: { initialConfig: ImagegenConfigPayload }) {
  const [config, setConfig] = useState(initialConfig);
  const [enabled, setEnabled] = useState(initialConfig.enabled);
  const [endpoint, setEndpoint] = useState(initialConfig.endpoint);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(initialConfig.model);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch('/api/admin/imagegen-config', {
          body: JSON.stringify({
            enabled,
            endpoint: endpoint.trim(),
            apiKey: apiKey.trim(),
            model: model.trim(),
          }),
          headers: { 'content-type': 'application/json' },
          method: 'PUT',
        });
        const payload = (await response.json()) as ApiResponse<ImagegenConfigPayload>;
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? '保存失败');
        setConfig(payload.data);
        setApiKey('');
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : '保存失败');
      }
    });
  };

  return (
    <SectionCard
      contentClassName="grid gap-5"
      description="配置海报与生图服务。API Key 只在服务器保存，页面不回显明文。"
      title="海报与生图配置"
    >
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex items-center gap-3 rounded-[var(--radius-control)] border border-[color:var(--border-soft)] px-3 py-3 text-sm font-medium">
          <input
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            type="checkbox"
          />
          启用生图
        </label>
        <div className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[color:var(--border-soft)] px-3 py-3 text-sm">
          <span>API Key 状态</span>
          <Badge variant={config.apiKeyConfigured ? 'success' : 'warning'}>
            {config.apiKeyConfigured ? '已配置' : '未配置'}
          </Badge>
        </div>
        <Label className="grid gap-2 text-sm font-medium">
          Endpoint
          <Input
            onChange={(event) => setEndpoint(event.target.value)}
            value={endpoint}
          />
        </Label>
        <Label className="grid gap-2 text-sm font-medium">
          Model
          <Input
            onChange={(event) => setModel(event.target.value)}
            value={model}
          />
        </Label>
        <Label className="grid gap-2 text-sm font-medium md:col-span-2">
          API Key（留空会清除已保存 Key；如需保留请勿修改）
          <Input
            autoComplete="new-password"
            onChange={(event) => setApiKey(event.target.value)}
            type="password"
            value={apiKey}
          />
        </Label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          <Image className="mr-1 inline h-3.5 w-3.5" />
          版本 {config.revision}
        </span>
        <Button disabled={pending} onClick={save} type="button">
          <Save className="h-4 w-4" />
          保存配置
        </Button>
      </div>
    </SectionCard>
  );
}
