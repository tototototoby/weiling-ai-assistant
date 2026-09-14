'use client';

import { History, RotateCcw, Save } from 'lucide-react';
import { useState, useTransition } from 'react';
import { SectionCard } from '@/components/layout/section-card';
import { useLocale } from '@/components/providers/locale-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { LocalizedDateTime } from '@/components/ui/localized-date-time';
import type { AdminBotAgentConfigPayload } from '@/lib/admin-bot-agent-config';

interface ApiResponse {
  data: AdminBotAgentConfigPayload | null;
  error: { message: string } | null;
}

export function AdminBotAgentConfigPanel(input: {
  botId: string;
  initialData: AdminBotAgentConfigPayload;
}) {
  const { locale, t } = useLocale();
  const [data, setData] = useState(input.initialData);
  const [agentsAppendix, setAgentsAppendix] = useState(data.override.agentsAppendix);
  const [soulAppendix, setSoulAppendix] = useState(data.override.soulAppendix);
  const [changeReason, setChangeReason] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const changed = agentsAppendix !== data.override.agentsAppendix
    || soulAppendix !== data.override.soulAppendix;
  const synced = data.projection.syncStatus === 'synced'
    && data.projection.appliedGlobalRevision === data.globalRevision
    && data.projection.appliedOverrideRevision === data.override.revision;

  const applyPayload = (payload: AdminBotAgentConfigPayload) => {
    setData(payload);
    setAgentsAppendix(payload.override.agentsAppendix);
    setSoulAppendix(payload.override.soulAppendix);
    setChangeReason('');
  };

  const save = (reset = false) => {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/admin/bots/${input.botId}/agent-config`, {
          body: JSON.stringify({
            agentsAppendix: reset ? '' : agentsAppendix,
            changeReason,
            soulAppendix: reset ? '' : soulAppendix,
          }),
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        });
        const payload = await response.json() as ApiResponse;
        if (!response.ok || !payload.data) {
          setError(payload.error?.message ?? t((messages) => messages.adminBots.agentConfigFailed));
          return;
        }
        applyPayload(payload.data);
        setConfirmReset(false);
      } catch {
        setError(t((messages) => messages.adminBots.agentConfigFailed));
      }
    });
  };

  const restore = (revision: number) => {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/admin/bots/${input.botId}/agent-config`, {
          body: JSON.stringify({ changeReason, revision }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        });
        const payload = await response.json() as ApiResponse;
        if (!response.ok || !payload.data) {
          setError(payload.error?.message ?? t((messages) => messages.adminBots.agentConfigFailed));
          return;
        }
        applyPayload(payload.data);
        setShowHistory(false);
      } catch {
        setError(t((messages) => messages.adminBots.agentConfigFailed));
      }
    });
  };

  return (
    <SectionCard
      contentClassName="grid gap-5"
      description={t((messages) => messages.adminBots.agentConfigDescription)}
      title={t((messages) => messages.adminBots.agentConfigTitle)}
    >
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--border-soft)] pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={data.override.active ? 'warning' : 'neutral'}>
            {data.override.active
              ? t((messages) => messages.adminBots.agentConfigCustom)
              : t((messages) => messages.adminBots.agentConfigInherited)}
          </Badge>
          <Badge variant={data.projection.syncStatus === 'error' ? 'danger' : synced ? 'success' : 'warning'}>
            {data.projection.syncStatus === 'error'
              ? t((messages) => messages.adminBots.agentConfigError)
              : synced
                ? t((messages) => messages.adminBots.agentConfigSynced)
                : t((messages) => messages.adminBots.agentConfigPending)}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {t((messages) => messages.adminBots.agentConfigVersions({
              global: data.globalRevision,
              override: data.override.revision,
            }))}
          </span>
        </div>
        <Button onClick={() => setShowHistory(true)} size="sm" type="button" variant="outline">
          <History className="h-4 w-4" />
          {t((messages) => messages.adminBots.agentConfigHistory)}
        </Button>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <label className="grid gap-2 text-sm font-medium">
          {t((messages) => messages.adminBots.agentRulesAppendix)}
          <textarea
            className="min-h-64 w-full resize-y rounded-[var(--radius-control)] border border-input bg-[color:var(--surface)] px-3 py-2 font-mono text-sm leading-6 outline-none focus:ring-2 focus:ring-ring"
            maxLength={200_000}
            onChange={(event) => setAgentsAppendix(event.target.value)}
            placeholder={t((messages) => messages.adminBots.agentRulesPlaceholder)}
            spellCheck={false}
            value={agentsAppendix}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          {t((messages) => messages.adminBots.agentSoulAppendix)}
          <textarea
            className="min-h-64 w-full resize-y rounded-[var(--radius-control)] border border-input bg-[color:var(--surface)] px-3 py-2 font-mono text-sm leading-6 outline-none focus:ring-2 focus:ring-ring"
            maxLength={200_000}
            onChange={(event) => setSoulAppendix(event.target.value)}
            placeholder={t((messages) => messages.adminBots.agentSoulPlaceholder)}
            spellCheck={false}
            value={soulAppendix}
          />
        </label>
      </div>

      <label className="grid gap-2 text-sm font-medium">
        {t((messages) => messages.adminBots.agentChangeReason)} <span aria-hidden="true" className="text-destructive">*</span>
        <input
          className="h-10 rounded-[var(--radius-control)] border border-input bg-[color:var(--surface)] px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          maxLength={500}
          onChange={(event) => setChangeReason(event.target.value)}
          placeholder={t((messages) => messages.adminBots.agentChangeReasonPlaceholder)}
          value={changeReason}
        />
      </label>

      {data.projection.lastSyncError ? <ErrorNotice>{data.projection.lastSyncError}</ErrorNotice> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {t((messages) => messages.adminBots.agentConfigLastSync)}{' '}
          <LocalizedDateTime locale={locale} unavailableLabel={t((messages) => messages.common.unavailable)} value={data.projection.lastSyncedAt} />
        </span>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={isPending || !data.override.active}
            onClick={() => setConfirmReset(true)}
            type="button"
            variant="outline"
          >
            <RotateCcw className="h-4 w-4" />
            {t((messages) => messages.adminBots.agentConfigReset)}
          </Button>
          <Button disabled={isPending || !changed || !changeReason.trim()} onClick={() => save()} type="button">
            <Save className="h-4 w-4" />
            {isPending
              ? t((messages) => messages.adminBots.agentConfigSaving)
              : t((messages) => messages.adminBots.agentConfigSave)}
          </Button>
        </div>
      </div>

      <Dialog onOpenChange={setShowHistory} open={showHistory}>
        <DialogContent>
          <div className="grid gap-1 pr-10">
            <DialogTitle>{t((messages) => messages.adminBots.agentConfigHistory)}</DialogTitle>
            <DialogDescription>{t((messages) => messages.adminBots.agentConfigHistoryDescription)}</DialogDescription>
          </div>
          <div className="grid max-h-[60vh] gap-3 overflow-y-auto pr-1">
            {data.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t((messages) => messages.adminBots.agentConfigHistoryEmpty)}</p>
            ) : data.history.map((item) => (
              <article className="grid gap-2 rounded-[var(--radius-control)] border border-[color:var(--border-soft)] p-3" key={item.revision}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-sm">v{item.revision} · {item.updatedByEmail}</strong>
                  <LocalizedDateTime locale={locale} unavailableLabel="-" value={item.createdAt} />
                </div>
                <p className="m-0 text-sm text-muted-foreground">{item.changeReason}</p>
                <Button
                  disabled={isPending || !changeReason.trim() || item.revision === data.override.revision}
                  onClick={() => restore(item.revision)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <RotateCcw className="h-4 w-4" />
                  {t((messages) => messages.adminBots.agentConfigRestore)}
                </Button>
              </article>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setConfirmReset} open={confirmReset}>
        <DialogContent>
          <div className="grid gap-2 pr-10">
            <DialogTitle>{t((messages) => messages.adminBots.agentConfigResetTitle)}</DialogTitle>
            <DialogDescription>{t((messages) => messages.adminBots.agentConfigResetDescription)}</DialogDescription>
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirmReset(false)} type="button" variant="outline">{t((messages) => messages.adminBots.cancel)}</Button>
            <Button disabled={isPending || !changeReason.trim()} onClick={() => save(true)} type="button">{t((messages) => messages.adminBots.confirm)}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
