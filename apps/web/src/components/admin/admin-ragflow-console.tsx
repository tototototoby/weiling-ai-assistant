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
import type { AdminRagflowPayload } from '@/lib/ragflow-admin';
import { cn } from '@/lib/utils';

interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string } | null;
}

export function AdminRagflowConsole({ initialData }: { initialData: AdminRagflowPayload }) {
  const { locale, t } = useLocale();
  const [data, setData] = useState(initialData);
  const [enabled, setEnabled] = useState(initialData.config.enabled);
  const [apiBaseUrl, setApiBaseUrl] = useState(initialData.config.apiBaseUrl);
  const [apiKey, setApiKey] = useState('');
  const [knowledgeBaseName, setKnowledgeBaseName] = useState(initialData.config.knowledgeBaseName);
  const [datasetIdsText, setDatasetIdsText] = useState(initialData.config.datasetIds.join('\n'));
  const [pendingAction, setPendingAction] = useState<'save' | 'test' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const datasetIds = parseDatasetIds(datasetIdsText);

  const readPayload = async (response: Response) => {
    const payload = (await response.json()) as ApiResponse<AdminRagflowPayload>;
    if (!response.ok || !payload.data) {
      throw new Error(payload.error?.message ?? t((messages) => messages.adminRagflow.commandFailed));
    }
    return payload.data;
  };

  const applySavedData = (nextData: AdminRagflowPayload) => {
    setData(nextData);
    setEnabled(nextData.config.enabled);
    setApiBaseUrl(nextData.config.apiBaseUrl);
    setKnowledgeBaseName(nextData.config.knowledgeBaseName);
    setDatasetIdsText(nextData.config.datasetIds.join('\n'));
    setApiKey('');
  };

  const save = () => {
    setErrorMessage(null);
    setPendingAction('save');
    startTransition(async () => {
      try {
        const response = await fetch('/api/admin/ragflow', {
          body: JSON.stringify({
            apiBaseUrl,
            ...(apiKey.trim() ? { apiKey } : {}),
            datasetIds,
            enabled,
            knowledgeBaseName,
          }),
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        });
        applySavedData(await readPayload(response));
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : t((messages) => messages.adminRagflow.commandFailed));
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
        const response = await fetch('/api/admin/ragflow/test', {
          body: JSON.stringify({
            apiBaseUrl,
            ...(apiKey.trim() ? { apiKey } : {}),
            datasetIds,
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        });
        setData(await readPayload(response));
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : t((messages) => messages.adminRagflow.testFailed));
        try {
          setData(await readPayload(await fetch('/api/admin/ragflow')));
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
    || knowledgeBaseName !== data.config.knowledgeBaseName
    || JSON.stringify(datasetIds) !== JSON.stringify(data.config.datasetIds)
    || Boolean(apiKey.trim());
  const apiKeyAvailable = data.config.apiKeyConfigured || Boolean(apiKey.trim());
  const enabledConfigIncomplete = enabled && (
    !apiBaseUrl.trim() || datasetIds.length === 0 || !apiKeyAvailable
  );
  const testConfigIncomplete = !apiBaseUrl.trim() || datasetIds.length === 0 || !apiKeyAvailable;

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryMetric label={t((messages) => messages.adminRagflow.revision)} value={data.config.revision} />
        <SummaryMetric label={t((messages) => messages.adminRagflow.syncedBots)} value={data.summary.syncedCount} />
        <SummaryMetric label={t((messages) => messages.adminRagflow.pendingBots)} value={data.summary.pendingCount + data.summary.errorCount} />
      </div>

      {errorMessage ? <ErrorNotice>{errorMessage}</ErrorNotice> : null}

      <SectionCard
        contentClassName="grid gap-5"
        description={t((messages) => messages.adminRagflow.configDescription)}
        title={t((messages) => messages.adminRagflow.configTitle)}
      >
        <label className="flex items-start gap-3 rounded-[var(--radius-control)] border border-[color:var(--border-soft)] bg-[color:var(--surface-muted)] px-4 py-3">
          <input
            checked={enabled}
            className="mt-1 h-4 w-4 accent-primary"
            onChange={(event) => setEnabled(event.target.checked)}
            type="checkbox"
          />
          <span className="grid gap-1">
            <strong className="text-sm font-semibold text-foreground">{t((messages) => messages.adminRagflow.enabled)}</strong>
            <span className="text-xs leading-5 text-muted-foreground">{t((messages) => messages.adminRagflow.enabledDescription)}</span>
          </span>
        </label>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="ragflow-api-base-url">{t((messages) => messages.adminRagflow.apiBaseUrl)}</Label>
            <Input
              id="ragflow-api-base-url"
              maxLength={2_000}
              onChange={(event) => setApiBaseUrl(event.target.value)}
              placeholder="https://ragflow.example.com/api/v1"
              value={apiBaseUrl}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ragflow-knowledge-base-name">{t((messages) => messages.adminRagflow.knowledgeBaseName)}</Label>
            <Input
              id="ragflow-knowledge-base-name"
              maxLength={100}
              onChange={(event) => setKnowledgeBaseName(event.target.value)}
              value={knowledgeBaseName}
            />
          </div>
          <div className="grid gap-2 lg:col-span-2">
            <Label htmlFor="ragflow-dataset-ids">{t((messages) => messages.adminRagflow.datasetIds)}</Label>
            <textarea
              className={cn(
                'min-h-28 w-full resize-y rounded-[var(--radius-control)] border border-input bg-background px-3 py-2 text-sm text-foreground',
                'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
              )}
              id="ragflow-dataset-ids"
              maxLength={20_000}
              onChange={(event) => setDatasetIdsText(event.target.value)}
              placeholder={t((messages) => messages.adminRagflow.datasetIdsPlaceholder)}
              value={datasetIdsText}
            />
            <span className="text-xs text-muted-foreground">{t((messages) => messages.adminRagflow.datasetIdsHelp)}</span>
          </div>
          <div className="grid gap-2 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="ragflow-api-key">{t((messages) => messages.adminRagflow.apiKey)}</Label>
              <Badge variant={data.config.apiKeyConfigured ? 'success' : 'warning'}>
                {data.config.apiKeyConfigured
                  ? t((messages) => messages.adminRagflow.apiKeyConfigured)
                  : t((messages) => messages.adminRagflow.apiKeyMissing)}
              </Badge>
            </div>
            <Input id="ragflow-api-key" maxLength={2_000} onChange={(event) => setApiKey(event.target.value)} type="password" value={apiKey} />
            <span className="text-xs text-muted-foreground">{t((messages) => messages.adminRagflow.apiKeyKeepCurrent)}</span>
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
              {t((messages) => messages.adminRagflow.lastTest)}{' '}
              <LocalizedDateTime locale={locale} unavailableLabel={t((messages) => messages.common.unavailable)} value={data.config.lastTestedAt} />
              {data.config.lastTestError ? ` | ${data.config.lastTestError}` : ''}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={isPending || testConfigIncomplete} onClick={testConnection} type="button" variant="outline">
              <RefreshCw className="h-4 w-4" />
              {pendingAction === 'test' ? t((messages) => messages.adminRagflow.testing) : t((messages) => messages.adminRagflow.testConnection)}
            </Button>
            <Button disabled={isPending || !configChanged || !knowledgeBaseName.trim() || enabledConfigIncomplete} onClick={save} type="button">
              {pendingAction === 'save' ? t((messages) => messages.adminRagflow.saving) : t((messages) => messages.adminRagflow.save)}
            </Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        contentClassName="grid gap-3"
        description={t((messages) => messages.adminRagflow.publicationDescription)}
        title={t((messages) => messages.adminRagflow.publicationTitle)}
      >
        {data.applications.length === 0 ? (
          <p className="m-0 rounded-[var(--radius-control)] border border-dashed border-[color:var(--border-soft)] px-4 py-6 text-sm text-muted-foreground">
            {t((messages) => messages.adminRagflow.emptyBots)}
          </p>
        ) : data.applications.map((application) => {
          const synced = application.syncStatus === 'synced' && application.appliedRevision === data.config.revision;
          const failed = application.syncStatus === 'error' || Boolean(application.lastSyncError);
          return (
            <article className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[color:var(--border-soft)] bg-[color:var(--surface)] px-4 py-3" key={application.botId}>
              <div className="grid gap-1">
                <strong className="text-sm font-semibold text-foreground">{application.botName}</strong>
                <span className="text-xs text-muted-foreground">
                  {t((messages) => messages.adminRagflow.desiredApplied)} {data.config.revision} / {application.appliedRevision}
                  {' | '}{t((messages) => messages.adminRagflow.lastSync)}{' '}
                  <LocalizedDateTime locale={locale} unavailableLabel={t((messages) => messages.common.unavailable)} value={application.lastSyncedAt} />
                </span>
                {application.lastSyncError ? <span className="text-xs text-destructive">{application.lastSyncError}</span> : null}
              </div>
              <Badge variant={failed ? 'danger' : synced ? 'success' : 'warning'}>
                {failed
                  ? t((messages) => messages.adminRagflow.syncError)
                  : synced
                    ? t((messages) => messages.adminRagflow.synced)
                    : t((messages) => messages.adminRagflow.syncPending)}
              </Badge>
            </article>
          );
        })}
      </SectionCard>
    </div>
  );
}

function parseDatasetIds(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))].sort();
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <dl className="grid gap-2 rounded-[var(--radius-panel)] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4">
      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--text-soft)]">{label}</dt>
      <dd className="m-0 text-2xl font-semibold text-foreground">{value}</dd>
    </dl>
  );
}
