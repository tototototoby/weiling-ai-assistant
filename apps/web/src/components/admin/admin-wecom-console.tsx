'use client';

import { useState, useTransition } from 'react';
import { ArrowUpRight, RefreshCw, RotateCcw, Save } from 'lucide-react';
import Link from 'next/link';
import { SectionCard } from '@/components/layout/section-card';
import { useLocale } from '@/components/providers/locale-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LocalizedDateTime } from '@/components/ui/localized-date-time';
import type { AdminWecomPayload } from '@/lib/wecom-admin';

interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string } | null;
}

export function AdminWecomConsole({ initialData }: { initialData: AdminWecomPayload }) {
  const { locale, t } = useLocale();
  const [data, setData] = useState(initialData);
  const [enabled, setEnabled] = useState(initialData.config.enabled);
  const [botId, setBotId] = useState(initialData.config.botId);
  const [secret, setSecret] = useState('');
  const [wsUrl, setWsUrl] = useState(initialData.config.wsUrl);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const applyData = (nextData: AdminWecomPayload) => {
    setData(nextData);
    setEnabled(nextData.config.enabled);
    setBotId(nextData.config.botId);
    setWsUrl(nextData.config.wsUrl);
    setSecret('');
  };

  const readPayload = async (response: Response) => {
    const payload = (await response.json()) as ApiResponse<AdminWecomPayload>;
    if (!response.ok || !payload.data) {
      throw new Error(payload.error?.message ?? t((messages) => messages.adminWecom.commandFailed));
    }
    return payload.data;
  };

  const mutate = (action: string, request: () => Promise<Response>) => {
    setErrorMessage(null);
    setPendingAction(action);
    startTransition(async () => {
      try {
        applyData(await readPayload(await request()));
      } catch (error) {
        setErrorMessage(error instanceof Error
          ? error.message
          : t((messages) => messages.adminWecom.commandFailed));
      } finally {
        setPendingAction(null);
      }
    });
  };

  const saveConfig = () => mutate('config', () => fetch('/api/admin/wecom', {
    body: JSON.stringify({
      botId,
      enabled,
      ...(secret.trim() ? { secret } : {}),
      wsUrl,
    }),
    headers: { 'content-type': 'application/json' },
    method: 'PATCH',
  }));

  const reconnect = () => mutate(
    'reconnect',
    () => fetch('/api/admin/wecom/reconnect', { method: 'POST' }),
  );

  const resetOnboarding = (resetToken: string) => mutate(
    `onboarding:${resetToken}`,
    () => fetch('/api/admin/wecom/onboarding/reset', {
      body: JSON.stringify({ resetToken }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  );

  const configChanged = enabled !== data.config.enabled
    || botId !== data.config.botId
    || wsUrl !== data.config.wsUrl
    || Boolean(secret.trim());
  const secretAvailable = data.config.secretConfigured || Boolean(secret.trim());
  const enabledConfigIncomplete = enabled && (!botId.trim() || !wsUrl.trim() || !secretAvailable);
  const connectionStatusLabel = getConnectionStatusLabel(data.config.connectionStatus, t);
  const connectionBadgeVariant = data.config.connectionStatus === 'connected'
    ? 'success'
    : data.config.connectionStatus === 'error'
      ? 'danger'
      : 'warning';

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <SummaryMetric label={t((messages) => messages.adminWecom.botCount)} value={data.summary.botCount} />
        <SummaryMetric label={t((messages) => messages.adminWecom.boundCount)} value={data.summary.boundCount} />
        <SummaryMetric label={t((messages) => messages.adminWecom.enabledCount)} value={data.summary.enabledCount} />
        <SummaryMetric label={t((messages) => messages.adminWecom.errorCount)} value={data.summary.errorCount} />
        <SummaryMetric
          label={t((messages) => messages.adminWecom.pendingOnboardingCount)}
          value={data.summary.pendingOnboardingCount}
        />
        <SummaryMetric
          label={t((messages) => messages.adminWecom.cooldownOnboardingCount)}
          value={data.summary.cooldownOnboardingCount}
        />
      </div>

      {errorMessage ? <ErrorNotice>{errorMessage}</ErrorNotice> : null}

      <SectionCard
        contentClassName="grid gap-5"
        description={t((messages) => messages.adminWecom.configDescription)}
        title={t((messages) => messages.adminWecom.configTitle)}
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[color:var(--border-soft)] pb-4">
          <label className="flex min-w-0 items-start gap-3">
            <input
              checked={enabled}
              className="mt-1 h-4 w-4 accent-primary"
              onChange={(event) => setEnabled(event.target.checked)}
              type="checkbox"
            />
            <span className="grid gap-1">
              <strong className="text-sm font-semibold text-foreground">
                {t((messages) => messages.adminWecom.enabled)}
              </strong>
              <span className="text-xs leading-5 text-muted-foreground">
                {t((messages) => messages.adminWecom.enabledDescription)}
              </span>
            </span>
          </label>
          <Badge variant={connectionBadgeVariant}>{connectionStatusLabel}</Badge>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="wecom-bot-id">{t((messages) => messages.adminWecom.botId)}</Label>
            <Input
              id="wecom-bot-id"
              maxLength={128}
              onChange={(event) => setBotId(event.target.value)}
              value={botId}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="wecom-ws-url">{t((messages) => messages.adminWecom.wsUrl)}</Label>
            <Input
              id="wecom-ws-url"
              maxLength={2_000}
              onChange={(event) => setWsUrl(event.target.value)}
              value={wsUrl}
            />
          </div>
          <div className="grid gap-2 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="wecom-secret">{t((messages) => messages.adminWecom.secret)}</Label>
              <Badge variant={data.config.secretConfigured ? 'success' : 'warning'}>
                {data.config.secretConfigured
                  ? t((messages) => messages.adminWecom.secretConfigured)
                  : t((messages) => messages.adminWecom.secretMissing)}
              </Badge>
            </div>
            <Input
              id="wecom-secret"
              maxLength={2_000}
              onChange={(event) => setSecret(event.target.value)}
              type="password"
              value={secret}
            />
            <span className="text-xs text-muted-foreground">
              {t((messages) => messages.adminWecom.secretKeepCurrent)}
            </span>
          </div>
        </div>

        <div className="grid gap-2 border-t border-[color:var(--border-soft)] pt-4 text-xs text-muted-foreground sm:grid-cols-2">
          <span>
            {t((messages) => messages.adminWecom.revision)} {data.config.revision}
            {' / '}{t((messages) => messages.adminWecom.observedRevision)} {data.config.observedRevision ?? '-'}
          </span>
          <span>
            {t((messages) => messages.adminWecom.lastConnected)}{' '}
            <LocalizedDateTime
              locale={locale}
              unavailableLabel={t((messages) => messages.common.unavailable)}
              value={data.config.lastConnectedAt}
            />
          </span>
          <span>
            {t((messages) => messages.adminWecom.lastDisconnected)}{' '}
            <LocalizedDateTime
              locale={locale}
              unavailableLabel={t((messages) => messages.common.unavailable)}
              value={data.config.lastDisconnectedAt}
            />
          </span>
          {data.config.lastError ? <span className="text-destructive sm:col-span-2">{data.config.lastError}</span> : null}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-[color:var(--border-soft)] pt-4">
          <Button
            disabled={isPending || !data.config.enabled || !data.config.secretConfigured || !data.config.botId}
            onClick={reconnect}
            type="button"
            variant="outline"
          >
            <RefreshCw className="h-4 w-4" />
            {pendingAction === 'reconnect'
              ? t((messages) => messages.adminWecom.reconnecting)
              : t((messages) => messages.adminWecom.reconnect)}
          </Button>
          <Button
            disabled={isPending || !configChanged || enabledConfigIncomplete}
            onClick={saveConfig}
            type="button"
          >
            <Save className="h-4 w-4" />
            {pendingAction === 'config'
              ? t((messages) => messages.adminWecom.saving)
              : t((messages) => messages.adminWecom.saveConfig)}
          </Button>
        </div>
      </SectionCard>

      <SectionCard
        contentClassName="grid gap-0"
        description={t((messages) => messages.adminWecom.onboardingDescription)}
        title={t((messages) => messages.adminWecom.onboardingTitle)}
      >
        {data.onboardingSessions.length === 0 ? (
          <p className="m-0 py-6 text-sm text-muted-foreground">
            {t((messages) => messages.adminWecom.onboardingEmpty)}
          </p>
        ) : data.onboardingSessions.map((session) => (
          <article
            className="grid gap-4 border-b border-[color:var(--border-soft)] py-5 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
            key={session.resetToken}
          >
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm font-semibold text-foreground">
                  {session.maskedWecomUserId}
                </strong>
                <Badge variant={session.state === 'cooldown' ? 'danger' : 'warning'}>
                  {session.state === 'cooldown'
                    ? t((messages) => messages.adminWecom.onboardingCooldown)
                    : t((messages) => messages.adminWecom.onboardingPending)}
                </Badge>
              </div>
              <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
                <span>
                  {t((messages) => messages.adminWecom.onboardingAttempts({ count: session.attemptCount }))}
                </span>
                <span>
                  {t((messages) => messages.adminWecom.onboardingStarted)}{' '}
                  <LocalizedDateTime locale={locale} unavailableLabel="-" value={session.createdAt} />
                </span>
                <span>
                  {t((messages) => messages.adminWecom.onboardingUpdated)}{' '}
                  <LocalizedDateTime locale={locale} unavailableLabel="-" value={session.updatedAt} />
                </span>
                <span>
                  {session.state === 'cooldown'
                    ? t((messages) => messages.adminWecom.onboardingCooldownUntil)
                    : t((messages) => messages.adminWecom.onboardingExpires)}{' '}
                  <LocalizedDateTime
                    locale={locale}
                    unavailableLabel="-"
                    value={session.state === 'cooldown' ? session.cooldownUntil : session.expiresAt}
                  />
                </span>
              </div>
            </div>
            <Button
              disabled={isPending}
              onClick={() => resetOnboarding(session.resetToken)}
              type="button"
              variant="outline"
            >
              <RotateCcw className="h-4 w-4" />
              {pendingAction === `onboarding:${session.resetToken}`
                ? t((messages) => messages.adminWecom.onboardingResetting)
                : t((messages) => messages.adminWecom.onboardingReset)}
            </Button>
          </article>
        ))}
      </SectionCard>

      <SectionCard
        contentClassName="grid gap-0"
        description={t((messages) => messages.adminWecom.bindingsDescription)}
        title={t((messages) => messages.adminWecom.bindingsTitle)}
      >
        {data.bots.length === 0 ? (
          <p className="m-0 py-6 text-sm text-muted-foreground">
            {t((messages) => messages.adminWecom.emptyBots)}
          </p>
        ) : data.bots.map((bot) => (
          <article
            className="grid gap-4 border-b border-[color:var(--border-soft)] py-5 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
            key={bot.botId}
          >
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm font-semibold text-foreground">{bot.botName}</strong>
                <Badge variant={bot.bound ? (bot.enabled ? 'success' : 'warning') : 'neutral'}>
                  {bot.bound
                    ? (bot.enabled
                        ? t((messages) => messages.adminWecom.bindingEnabled)
                        : t((messages) => messages.adminWecom.bindingDisabled))
                    : t((messages) => messages.adminWecom.bindingUnbound)}
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground">
                {t((messages) => messages.adminWecom.owner)} {bot.ownerEmail ?? bot.ownerUserId}
                {bot.wecomUserId ? ` · ${bot.wecomUserId}` : ''}
              </span>
              {bot.lastError ? <span className="text-xs text-destructive">{bot.lastError}</span> : null}
            </div>
            <Button asChild variant="outline">
              <Link href={`/admin/bots/${bot.botId}`}>
                {t((messages) => messages.adminWecom.manageInBot)}
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </Button>
          </article>
        ))}
      </SectionCard>
    </div>
  );
}

function getConnectionStatusLabel(
  status: string,
  t: ReturnType<typeof useLocale>['t'],
): string {
  if (status === 'connected') return t((messages) => messages.adminWecom.statusConnected);
  if (status === 'connecting') return t((messages) => messages.adminWecom.statusConnecting);
  if (status === 'error') return t((messages) => messages.adminWecom.statusError);
  return t((messages) => messages.adminWecom.statusDisabled);
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <dl className="grid gap-2 rounded-[var(--radius-panel)] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4">
      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--text-soft)]">{label}</dt>
      <dd className="m-0 text-2xl font-semibold text-foreground">{value}</dd>
    </dl>
  );
}
