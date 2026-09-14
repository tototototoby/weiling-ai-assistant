'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, Database, RefreshCw, TriangleAlert } from 'lucide-react';
import { SectionCard } from '@/components/layout/section-card';
import { useLocale } from '@/components/providers/locale-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LocalizedDateTime } from '@/components/ui/localized-date-time';
import type { AdminDifyPayload } from '@/lib/dify-admin';

interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string } | null;
}

export function AdminDifyConsole({ initialData }: { initialData: AdminDifyPayload }) {
  const { locale, t } = useLocale();
  const [data, setData] = useState(initialData);
  const [enabled, setEnabled] = useState(initialData.config.enabled);
  const [apiBaseUrl, setApiBaseUrl] = useState(initialData.config.apiBaseUrl);
  const [apiKey, setApiKey] = useState('');
  const [appName, setAppName] = useState(initialData.config.appName);
  const [pendingAction, setPendingAction] = useState<'save' | 'test' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const readPayload = async (response: Response) => {
    const payload = (await response.json()) as ApiResponse<AdminDifyPayload>;
    if (!response.ok || !payload.data) {
      throw new Error(payload.error?.message ?? t((messages) => messages.adminDify.commandFailed));
    }
    return payload.data;
  };

  const applyData = (nextData: AdminDifyPayload) => {
    setData(nextData);
    setEnabled(nextData.config.enabled);
    setApiBaseUrl(nextData.config.apiBaseUrl);
    setAppName(nextData.config.appName);
    setApiKey('');
  };

  const save = () => {
    setErrorMessage(null);
    setPendingAction('save');
    startTransition(async () => {
      try {
        const response = await fetch('/api/admin/dify', {
          body: JSON.stringify({
            apiBaseUrl,
            ...(apiKey.trim() ? { apiKey } : {}),
            appName,
            enabled,
          }),
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        });
        applyData(await readPayload(response));
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : t((messages) => messages.adminDify.commandFailed));
      } finally {
        setPendingAction(null);
      }
    });
  };

  const testConnection = () => {
    setErrorMessage(null);
    setPendingAction('test');
    startTransition(async () => {
      try {
        const response = await fetch('/api/admin/dify/test', {
          body: JSON.stringify({
            apiBaseUrl,
            ...(apiKey.trim() ? { apiKey } : {}),
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        });
        applyData(await readPayload(response));
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : t((messages) => messages.adminDify.testFailed));
        try {
          applyData(await readPayload(await fetch('/api/admin/dify')));
        } catch {
          // Keep the submitted fields visible when the status refresh also fails.
        }
      } finally {
        setPendingAction(null);
      }
    });
  };

  const configChanged = enabled !== data.config.enabled
    || apiBaseUrl !== data.config.apiBaseUrl
    || appName !== data.config.appName
    || Boolean(apiKey.trim());

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryMetric label={t((messages) => messages.adminDify.revision)} value={data.config.revision} />
        <SummaryMetric label={t((messages) => messages.adminDify.syncedBots)} value={data.summary.syncedCount} />
        <SummaryMetric label={t((messages) => messages.adminDify.pendingBots)} value={data.summary.pendingCount + data.summary.errorCount} />
      </div>

      {errorMessage ? <ErrorNotice>{errorMessage}</ErrorNotice> : null}

      <SectionCard
        contentClassName="grid gap-5"
        description={t((messages) => messages.adminDify.configDescription)}
        title={t((messages) => messages.adminDify.configTitle)}
      >
        <label className="flex items-start gap-3 rounded-[var(--radius-control)] border border-[color:var(--border-soft)] bg-[color:var(--surface-muted)] px-4 py-3">
          <input
            checked={enabled}
            className="mt-1 h-4 w-4 accent-primary"
            onChange={(event) => setEnabled(event.target.checked)}
            type="checkbox"
          />
          <span className="grid gap-1">
            <strong className="text-sm font-semibold text-foreground">{t((messages) => messages.adminDify.enabled)}</strong>
            <span className="text-xs leading-5 text-muted-foreground">{t((messages) => messages.adminDify.enabledDescription)}</span>
          </span>
        </label>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="dify-api-base-url">{t((messages) => messages.adminDify.apiBaseUrl)}</Label>
            <Input
              id="dify-api-base-url"
              maxLength={2_000}
              onChange={(event) => setApiBaseUrl(event.target.value)}
              placeholder="https://dify.example.com/v1"
              value={apiBaseUrl}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dify-app-name">{t((messages) => messages.adminDify.appName)}</Label>
            <Input id="dify-app-name" maxLength={100} onChange={(event) => setAppName(event.target.value)} value={appName} />
          </div>
          <div className="grid gap-2 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="dify-api-key">{t((messages) => messages.adminDify.apiKey)}</Label>
              <Badge variant={data.config.apiKeyConfigured ? 'success' : 'warning'}>
                {data.config.apiKeyConfigured
                  ? t((messages) => messages.adminDify.apiKeyConfigured)
                  : t((messages) => messages.adminDify.apiKeyMissing)}
              </Badge>
            </div>
            <Input id="dify-api-key" maxLength={2_000} onChange={(event) => setApiKey(event.target.value)} type="password" value={apiKey} />
            <span className="text-xs text-muted-foreground">{t((messages) => messages.adminDify.apiKeyKeepCurrent)}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--border-soft)] pt-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {data.config.lastTestStatus === 'success'
              ? <CheckCircle2 className="h-4 w-4 text-[color:var(--status-success)]" />
              : data.config.lastTestStatus === 'error'
                ? <TriangleAlert className="h-4 w-4 text-destructive" />
                : <Database className="h-4 w-4" />}
            <span>
              {t((messages) => messages.adminDify.lastTest)}{' '}
              <LocalizedDateTime locale={locale} unavailableLabel={t((messages) => messages.common.unavailable)} value={data.config.lastTestedAt} />
              {data.config.lastTestError ? ` · ${data.config.lastTestError}` : ''}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={isPending || !apiBaseUrl.trim()} onClick={testConnection} type="button" variant="outline">
              <RefreshCw className="h-4 w-4" />
              {pendingAction === 'test' ? t((messages) => messages.adminDify.testing) : t((messages) => messages.adminDify.testConnection)}
            </Button>
            <Button disabled={isPending || !configChanged || !appName.trim()} onClick={save} type="button">
              {pendingAction === 'save' ? t((messages) => messages.adminDify.saving) : t((messages) => messages.adminDify.save)}
            </Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        contentClassName="grid gap-3"
        description={t((messages) => messages.adminDify.publicationDescription)}
        title={t((messages) => messages.adminDify.publicationTitle)}
      >
        {data.applications.length === 0 ? (
          <p className="m-0 rounded-[var(--radius-control)] border border-dashed border-[color:var(--border-soft)] px-4 py-6 text-sm text-muted-foreground">
            {t((messages) => messages.adminDify.emptyBots)}
          </p>
        ) : data.applications.map((application) => {
          const synced = application.syncStatus === 'synced' && application.appliedRevision === data.config.revision;
          const failed = application.syncStatus === 'error' || Boolean(application.lastSyncError);
          return (
            <article className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[color:var(--border-soft)] bg-[color:var(--surface)] px-4 py-3" key={application.botId}>
              <div className="grid gap-1">
                <strong className="text-sm font-semibold text-foreground">{application.botName}</strong>
                <span className="text-xs text-muted-foreground">
                  {t((messages) => messages.adminDify.desiredApplied)} {data.config.revision} / {application.appliedRevision}
                  {' · '}{t((messages) => messages.adminDify.lastSync)}{' '}
                  <LocalizedDateTime locale={locale} unavailableLabel={t((messages) => messages.common.unavailable)} value={application.lastSyncedAt} />
                </span>
                {application.lastSyncError ? <span className="text-xs text-destructive">{application.lastSyncError}</span> : null}
              </div>
              <Badge variant={failed ? 'danger' : synced ? 'success' : 'warning'}>
                {failed
                  ? t((messages) => messages.adminDify.syncError)
                  : synced
                    ? t((messages) => messages.adminDify.synced)
                    : t((messages) => messages.adminDify.syncPending)}
              </Badge>
            </article>
          );
        })}
      </SectionCard>
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <dl className="grid gap-2 rounded-[var(--radius-panel)] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4">
      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--text-soft)]">{label}</dt>
      <dd className="m-0 text-2xl font-semibold text-foreground">{value}</dd>
    </dl>
  );
}
