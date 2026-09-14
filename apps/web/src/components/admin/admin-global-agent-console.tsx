'use client';

import type { ReactNode } from 'react';
import { useState, useTransition } from 'react';
import { Bot, Boxes, CheckCircle2, Eye, FileText, RefreshCw, TriangleAlert } from 'lucide-react';
import { SectionCard } from '@/components/layout/section-card';
import { useLocale } from '@/components/providers/locale-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { LocalizedDateTime } from '@/components/ui/localized-date-time';
import type { AdminGlobalAgentPayload, AdminGlobalAgentSkill } from '@/lib/global-agent-admin';

interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string } | null;
}

type DocumentKey = 'agents' | 'soul';

export function AdminGlobalAgentConsole({ initialData }: { initialData: AdminGlobalAgentPayload }) {
  const { locale, t } = useLocale();
  const [data, setData] = useState(initialData);
  const [activeDocument, setActiveDocument] = useState<DocumentKey>('agents');
  const [agentsMarkdown, setAgentsMarkdown] = useState(initialData.config.agentsMarkdown);
  const [soulMarkdown, setSoulMarkdown] = useState(initialData.config.soulMarkdown);
  const [inspectingSkill, setInspectingSkill] = useState<AdminGlobalAgentSkill | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const documentChanged = agentsMarkdown !== data.config.agentsMarkdown
    || soulMarkdown !== data.config.soulMarkdown;

  const saveDocuments = () => {
    setErrorMessage(null);
    setPendingAction('documents');
    startTransition(async () => {
      try {
        const response = await fetch('/api/admin/global-agent', {
          body: JSON.stringify({ agentsMarkdown, soulMarkdown }),
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        });
        const payload = (await response.json()) as ApiResponse<AdminGlobalAgentPayload>;

        if (!response.ok || !payload.data) {
          setErrorMessage(payload.error?.message ?? t((messages) => messages.adminGlobalAgent.commandFailed));
          return;
        }

        setData(payload.data);
        setAgentsMarkdown(payload.data.config.agentsMarkdown);
        setSoulMarkdown(payload.data.config.soulMarkdown);
      } catch {
        setErrorMessage(t((messages) => messages.adminGlobalAgent.commandFailed));
      } finally {
        setPendingAction(null);
      }
    });
  };

  const toggleSkill = (skill: AdminGlobalAgentSkill) => {
    setErrorMessage(null);
    setPendingAction(`skill:${skill.name}`);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/admin/global-agent/skills/${encodeURIComponent(skill.name)}`, {
          body: JSON.stringify({ enabled: !skill.enabled }),
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        });
        const payload = (await response.json()) as ApiResponse<AdminGlobalAgentPayload>;

        if (!response.ok || !payload.data) {
          setErrorMessage(payload.error?.message ?? t((messages) => messages.adminGlobalAgent.commandFailed));
          return;
        }

        setData(payload.data);
      } catch {
        setErrorMessage(t((messages) => messages.adminGlobalAgent.commandFailed));
      } finally {
        setPendingAction(null);
      }
    });
  };

  const republish = () => {
    setErrorMessage(null);
    setPendingAction('publish');
    startTransition(async () => {
      try {
        const response = await fetch('/api/admin/global-agent/publish', { method: 'POST' });
        const payload = (await response.json()) as ApiResponse<AdminGlobalAgentPayload>;

        if (!response.ok || !payload.data) {
          setErrorMessage(payload.error?.message ?? t((messages) => messages.adminGlobalAgent.commandFailed));
          return;
        }

        setData(payload.data);
      } catch {
        setErrorMessage(t((messages) => messages.adminGlobalAgent.commandFailed));
      } finally {
        setPendingAction(null);
      }
    });
  };

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryMetric icon={<FileText className="h-4 w-4" />} label={t((messages) => messages.adminGlobalAgent.revision)} value={data.config.revision} />
        <SummaryMetric icon={<Bot className="h-4 w-4" />} label={t((messages) => messages.adminGlobalAgent.totalBots)} value={data.summary.botCount} />
        <SummaryMetric icon={<CheckCircle2 className="h-4 w-4" />} label={t((messages) => messages.adminGlobalAgent.syncedBots)} value={data.summary.syncedCount} />
        <SummaryMetric icon={<TriangleAlert className="h-4 w-4" />} label={t((messages) => messages.adminGlobalAgent.pendingBots)} value={data.summary.pendingCount + data.summary.errorCount} />
      </div>

      {errorMessage ? <ErrorNotice>{errorMessage}</ErrorNotice> : null}

      <SectionCard
        contentClassName="grid gap-4"
        description={t((messages) => messages.adminGlobalAgent.documentsDescription)}
        title={t((messages) => messages.adminGlobalAgent.documentsTitle)}
      >
        <div className="rounded-[var(--radius-control)] border border-[color:var(--status-attention)]/25 bg-[color:var(--status-attention-soft)] px-4 py-3 text-sm leading-6 text-foreground">
          {t((messages) => messages.adminGlobalAgent.publishNotice)}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2" role="tablist">
            <Button aria-selected={activeDocument === 'agents'} onClick={() => setActiveDocument('agents')} role="tab" type="button" variant={activeDocument === 'agents' ? 'default' : 'outline'}>
              AGENTS.md
            </Button>
            <Button aria-selected={activeDocument === 'soul'} onClick={() => setActiveDocument('soul')} role="tab" type="button" variant={activeDocument === 'soul' ? 'default' : 'outline'}>
              SOUL.md
            </Button>
          </div>
          <span className="text-xs text-muted-foreground">
            {t((messages) => messages.adminGlobalAgent.lastUpdated)} <LocalizedDateTime locale={locale} unavailableLabel={t((messages) => messages.common.unavailable)} value={data.config.updatedAt} />
          </span>
        </div>

        {activeDocument === 'agents' ? (
          <textarea
            aria-label="AGENTS.md"
            className="min-h-[30rem] w-full resize-y rounded-[var(--radius-control)] border border-input bg-[color:var(--surface)] px-4 py-3 font-mono text-sm leading-6 text-foreground outline-none transition-shadow focus:ring-2 focus:ring-ring"
            maxLength={200_000}
            onChange={(event) => setAgentsMarkdown(event.target.value)}
            spellCheck={false}
            value={agentsMarkdown}
          />
        ) : (
          <textarea
            aria-label="SOUL.md"
            className="min-h-[30rem] w-full resize-y rounded-[var(--radius-control)] border border-input bg-[color:var(--surface)] px-4 py-3 font-mono text-sm leading-6 text-foreground outline-none transition-shadow focus:ring-2 focus:ring-ring"
            maxLength={200_000}
            onChange={(event) => setSoulMarkdown(event.target.value)}
            spellCheck={false}
            value={soulMarkdown}
          />
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button disabled={isPending} onClick={republish} type="button" variant="outline">
            <RefreshCw className="h-4 w-4" />
            {pendingAction === 'publish' ? t((messages) => messages.adminGlobalAgent.publishing) : t((messages) => messages.adminGlobalAgent.republish)}
          </Button>
          <Button disabled={isPending || !documentChanged || !agentsMarkdown.trim() || !soulMarkdown.trim()} onClick={saveDocuments} type="button">
            {pendingAction === 'documents' ? t((messages) => messages.adminGlobalAgent.saving) : t((messages) => messages.adminGlobalAgent.saveAndPublish)}
          </Button>
        </div>
      </SectionCard>

      <SectionCard
        contentClassName="grid gap-3"
        description={t((messages) => messages.adminGlobalAgent.publicationDescription)}
        title={t((messages) => messages.adminGlobalAgent.publicationTitle)}
      >
        {data.applications.length === 0 ? (
          <p className="m-0 rounded-[var(--radius-control)] border border-dashed border-[color:var(--border-soft)] px-4 py-6 text-sm text-muted-foreground">
            {t((messages) => messages.adminGlobalAgent.emptyBots)}
          </p>
        ) : data.applications.map((application) => {
          const synced = application.syncStatus === 'synced'
            && application.appliedRevision === data.config.revision;
          const failed = application.syncStatus === 'error' || Boolean(application.lastSyncError);
          return (
            <article className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[color:var(--border-soft)] bg-[color:var(--surface)] px-4 py-3" key={application.botId}>
              <div className="grid gap-1">
                <strong className="text-sm font-semibold text-foreground">{application.botName}</strong>
                <span className="text-xs text-muted-foreground">
                  {t((messages) => messages.adminGlobalAgent.desiredApplied)} {data.config.revision} / {application.appliedRevision}
                  {' · '}{t((messages) => messages.adminGlobalAgent.lastSync)}{' '}
                  <LocalizedDateTime locale={locale} unavailableLabel={t((messages) => messages.common.unavailable)} value={application.lastSyncedAt} />
                </span>
                {application.lastSyncError ? <span className="text-xs text-destructive">{application.lastSyncError}</span> : null}
              </div>
              <Badge variant={failed ? 'danger' : synced ? 'success' : 'warning'}>
                {failed
                  ? t((messages) => messages.adminGlobalAgent.syncError)
                  : synced
                    ? t((messages) => messages.adminGlobalAgent.synced)
                    : t((messages) => messages.adminGlobalAgent.syncPending)}
              </Badge>
            </article>
          );
        })}
      </SectionCard>

      <SectionCard
        contentClassName="grid gap-4"
        description={t((messages) => messages.adminGlobalAgent.skillsDescription)}
        title={t((messages) => messages.adminGlobalAgent.skillsTitle)}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Boxes className="h-4 w-4" />
            {t((messages) => messages.adminGlobalAgent.enabledSkillCount({ count: data.summary.enabledSkillCount, total: data.skills.length }))}
          </div>
          <span className="text-xs text-muted-foreground">{t((messages) => messages.adminGlobalAgent.skillsReadOnlyNotice)}</span>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          {data.skills.map((skill) => (
            <article className="grid gap-3 rounded-[var(--radius-panel)] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4" key={skill.name}>
              <div className="flex items-start justify-between gap-3">
                <div className="grid min-w-0 gap-1">
                  <strong className="truncate font-semibold text-foreground">{skill.name}</strong>
                  <p className="m-0 line-clamp-2 text-sm leading-6 text-muted-foreground">{skill.description}</p>
                </div>
                <Badge variant={skill.enabled ? 'success' : 'neutral'}>
                  {skill.enabled ? t((messages) => messages.adminGlobalAgent.enabled) : t((messages) => messages.adminGlobalAgent.disabled)}
                </Badge>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button onClick={() => setInspectingSkill(skill)} size="sm" type="button" variant="outline">
                  <Eye className="h-4 w-4" />
                  {t((messages) => messages.adminGlobalAgent.inspect)}
                </Button>
                <Button disabled={isPending} onClick={() => toggleSkill(skill)} size="sm" type="button" variant={skill.enabled ? 'outline' : 'default'}>
                  {pendingAction === `skill:${skill.name}`
                    ? t((messages) => messages.adminGlobalAgent.applying)
                    : skill.enabled
                      ? t((messages) => messages.adminGlobalAgent.disable)
                      : t((messages) => messages.adminGlobalAgent.enable)}
                </Button>
              </div>
            </article>
          ))}
        </div>
      </SectionCard>

      <Dialog onOpenChange={(open) => { if (!open) setInspectingSkill(null); }} open={Boolean(inspectingSkill)}>
        {inspectingSkill ? (
          <DialogContent className="max-w-4xl">
            <div className="grid gap-2 pr-10">
              <DialogTitle>{inspectingSkill.name}</DialogTitle>
              <DialogDescription>{inspectingSkill.description}</DialogDescription>
            </div>
            <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap rounded-[var(--radius-control)] border border-[color:var(--border-soft)] bg-[color:var(--surface-muted)] p-4 text-xs leading-6 text-foreground">
              {inspectingSkill.content}
            </pre>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

function SummaryMetric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <dl className="grid gap-2 rounded-[var(--radius-panel)] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4">
      <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--text-soft)]">{icon}{label}</dt>
      <dd className="m-0 text-2xl font-semibold text-foreground">{value}</dd>
    </dl>
  );
}
