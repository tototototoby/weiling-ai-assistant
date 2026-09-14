'use client';

import { useState, useTransition } from 'react';
import { RefreshCw, Save, Trash2 } from 'lucide-react';
import { SectionCard } from '@/components/layout/section-card';
import { useLocale } from '@/components/providers/locale-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LocalizedDateTime } from '@/components/ui/localized-date-time';
import type {
  AdminFeishuBotConfig,
  AdminFeishuPayload,
} from '@/lib/feishu-admin';

interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string } | null;
}

export function AdminFeishuConsole({ initialData }: { initialData: AdminFeishuPayload }) {
  const { locale, t } = useLocale();
  const [data, setData] = useState(initialData);
  const [editingBotId, setEditingBotId] = useState<string | null>(null);
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const failedMessage = t((messages) => messages.adminFeishu.commandFailed);

  const readPayload = async (response: Response) => {
    const payload = (await response.json()) as ApiResponse<unknown>;
    if (!response.ok || payload.error) {
      throw new Error(payload.error?.message ?? failedMessage);
    }
    return payload.data;
  };

  const refresh = (action: string, request: () => Promise<Response>) => {
    setErrorMessage(null);
    setPendingAction(action);
    startTransition(async () => {
      try {
        await readPayload(await request());
        const listResponse = await fetch('/api/admin/feishu');
        const listPayload = (await listResponse.json()) as ApiResponse<AdminFeishuPayload>;
        if (!listResponse.ok || !listPayload.data) {
          throw new Error(listPayload.error?.message ?? failedMessage);
        }
        setData(listPayload.data);
        if (action === 'save') setEditingBotId(null);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : failedMessage);
      } finally {
        setPendingAction(null);
      }
    });
  };

  const saveConfig = (botId: string) => refresh('save', () => fetch(`/api/admin/bots/${botId}/feishu`, {
    body: JSON.stringify({ appId, appSecret, enabled: true }),
    headers: { 'content-type': 'application/json' },
    method: 'PATCH',
  }));

  const disable = (botId: string) => refresh(`disable:${botId}`, () => fetch(`/api/admin/bots/${botId}/feishu`, {
    body: JSON.stringify({ enabled: false }),
    headers: { 'content-type': 'application/json' },
    method: 'PATCH',
  }));

  const clear = (botId: string) => {
    if (!window.confirm(t((messages) => messages.adminFeishu.clearConfirm))) return;
    refresh(`clear:${botId}`, () => fetch(`/api/admin/bots/${botId}/feishu`, {
      method: 'DELETE',
    }));
  };

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryMetric label={t((messages) => messages.adminFeishu.botCount)} value={data.summary.botCount} />
        <SummaryMetric label={t((messages) => messages.adminFeishu.configuredCount)} value={data.summary.configuredCount} />
        <SummaryMetric label={t((messages) => messages.adminFeishu.enabledCount)} value={data.summary.enabledCount} />
        <SummaryMetric label={t((messages) => messages.adminFeishu.connectedCount)} value={data.summary.connectedCount} />
        <SummaryMetric label={t((messages) => messages.adminFeishu.errorCount)} value={data.summary.errorCount} />
      </div>

      <div className="flex justify-end">
        <Button
          disabled={isPending}
          onClick={() => refresh('refresh', async () => new Response(null, { status: 200 }))}
          type="button"
          variant="outline"
        >
          <RefreshCw className="h-4 w-4" />
          {t((messages) => messages.adminFeishu.refresh)}
        </Button>
      </div>

      {errorMessage ? <ErrorNotice>{errorMessage}</ErrorNotice> : null}

      <SectionCard
        contentClassName="grid gap-0"
        description={t((messages) => messages.adminFeishu.configureDescription)}
        title={t((messages) => messages.adminFeishu.configureTitle)}
      >
        {data.bots.length === 0 ? (
          <p className="m-0 py-6 text-sm text-muted-foreground">
            {t((messages) => messages.adminFeishu.emptyBots)}
          </p>
        ) : data.bots.map((bot) => (
          <article
            className="grid gap-4 border-b border-[color:var(--border-soft)] py-5 last:border-b-0"
            key={bot.botId}
          >
            <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-sm font-semibold text-foreground">{bot.botName}</strong>
                  <StatusBadge bot={bot} />
                  <Badge variant={bot.appIdConfigured ? 'success' : 'neutral'}>
                    {bot.appIdConfigured
                      ? t((messages) => messages.adminFeishu.appIdConfigured)
                      : t((messages) => messages.adminFeishu.appIdMissing)}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  {t((messages) => messages.adminFeishu.owner)} {bot.ownerEmail ?? bot.ownerUserId}
                  {bot.ownerOpenId ? ` · ${t((messages) => messages.adminFeishu.ownerOpenId)} ${bot.ownerOpenId}` : ''}
                </span>
                <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  <span>
                    {t((messages) => messages.adminFeishu.lastConnected)}{' '}
                    <LocalizedDateTime
                      locale={locale}
                      unavailableLabel={t((messages) => messages.common.unavailable)}
                      value={bot.lastConnectedAt}
                    />
                  </span>
                  {bot.lastError ? (
                    <span className="text-destructive">
                      {t((messages) => messages.adminFeishu.lastError)} {bot.lastError}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={isPending}
                  onClick={() => {
                    setEditingBotId(bot.botId);
                    setAppId('');
                    setAppSecret('');
                  }}
                  type="button"
                  variant="outline"
                >
                  {t((messages) => messages.adminFeishu.configure)}
                </Button>
                <Button
                  disabled={isPending || !bot.appIdConfigured || !bot.enabled}
                  onClick={() => disable(bot.botId)}
                  type="button"
                  variant="outline"
                >
                  {pendingAction === `disable:${bot.botId}`
                    ? t((messages) => messages.adminFeishu.disabling)
                    : t((messages) => messages.adminFeishu.disable)}
                </Button>
                <Button
                  disabled={isPending || !bot.appIdConfigured}
                  onClick={() => clear(bot.botId)}
                  type="button"
                  variant="outline"
                >
                  <Trash2 className="h-4 w-4" />
                  {pendingAction === `clear:${bot.botId}`
                    ? t((messages) => messages.adminFeishu.clearing)
                    : t((messages) => messages.adminFeishu.clear)}
                </Button>
              </div>
            </div>

            {editingBotId === bot.botId ? (
              <div className="grid gap-4 rounded-[var(--radius-panel)] border border-[color:var(--border-soft)] bg-[color:var(--surface-muted)] p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor={`feishu-app-id-${bot.botId}`}>
                      {t((messages) => messages.adminFeishu.appId)}
                    </Label>
                    <Input
                      id={`feishu-app-id-${bot.botId}`}
                      maxLength={128}
                      onChange={(event) => setAppId(event.target.value)}
                      value={appId}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor={`feishu-app-secret-${bot.botId}`}>
                      {t((messages) => messages.adminFeishu.appSecret)}
                    </Label>
                    <Input
                      id={`feishu-app-secret-${bot.botId}`}
                      maxLength={2_000}
                      onChange={(event) => setAppSecret(event.target.value)}
                      type="password"
                      value={appSecret}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    disabled={isPending}
                    onClick={() => setEditingBotId(null)}
                    type="button"
                    variant="outline"
                  >
                    {t((messages) => messages.adminFeishu.cancel)}
                  </Button>
                  <Button
                    disabled={isPending || !appId.trim() || !appSecret.trim()}
                    onClick={() => saveConfig(bot.botId)}
                    type="button"
                  >
                    <Save className="h-4 w-4" />
                    {pendingAction === 'save'
                      ? t((messages) => messages.adminFeishu.saving)
                      : t((messages) => messages.adminFeishu.save)}
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

function StatusBadge({ bot }: { bot: AdminFeishuBotConfig }) {
  const { t } = useLocale();
  const variant = bot.eventStatus === 'connected'
    ? 'success'
    : bot.eventStatus === 'error'
      ? 'danger'
      : bot.eventStatus === 'connecting'
        ? 'warning'
        : 'neutral';
  const label = getStatusLabel(bot.eventStatus, t);
  return <Badge variant={variant}>{label}</Badge>;
}

function getStatusLabel(
  status: string,
  t: ReturnType<typeof useLocale>['t'],
): string {
  if (status === 'connected') return t((messages) => messages.adminFeishu.statusConnected);
  if (status === 'connecting') return t((messages) => messages.adminFeishu.statusConnecting);
  if (status === 'error') return t((messages) => messages.adminFeishu.statusError);
  if (status === 'disabled') return t((messages) => messages.adminFeishu.statusDisabled);
  return t((messages) => messages.adminFeishu.statusNotConfigured);
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <dl className="grid gap-2 rounded-[var(--radius-panel)] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4">
      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--text-soft)]">{label}</dt>
      <dd className="m-0 text-2xl font-semibold text-foreground">{value}</dd>
    </dl>
  );
}
