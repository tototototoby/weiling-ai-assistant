'use client';

import type { ReactNode } from 'react';
import { useMemo, useState, useTransition } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, CloudSun, Search, UsersRound } from 'lucide-react';
import { SectionCard } from '@/components/layout/section-card';
import { useLocale } from '@/components/providers/locale-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LocalizedDateTime } from '@/components/ui/localized-date-time';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getRuntimeStatusPresentation } from '@/lib/bot-status-presentation';
import {
  resolveMorningBriefingDeliveryStatus,
  type AdminMorningBriefingItem,
  type AdminMorningBriefingPayload,
} from '@/lib/morning-briefing-admin';

type Filter = 'all' | 'attention' | 'disabled' | 'enabled' | 'error' | 'optedOut' | 'pending';

interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string } | null;
}

interface EditorState {
  deliveryTime: string;
  forceEnabled: boolean;
  location: string;
}

export function AdminMorningBriefingsConsole({ initialData }: { initialData: AdminMorningBriefingPayload }) {
  const { locale, t } = useLocale();
  const [data, setData] = useState(initialData);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingItem, setEditingItem] = useState<AdminMorningBriefingItem | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return data.items.filter((item) => {
      const matchesQuery = !normalizedQuery || [item.botName, item.ownerEmail, item.location, item.botId]
        .some((value) => value?.toLowerCase().includes(normalizedQuery));
      const matchesFilter = filter === 'all'
        || (filter === 'enabled' && item.scheduleStatus === 'scheduled')
        || (filter === 'disabled' && item.scheduleStatus === 'disabled')
        || (filter === 'attention' && requiresScheduleAttention(item))
        || (filter === 'optedOut' && item.observedUserOptOut)
        || (filter === 'pending' && isPendingReconciliation(item))
        || (filter === 'error' && (
          item.syncStatus === 'error'
          || Boolean(item.lastSyncError)
          || Boolean(item.centralLastError)
        ));
      return matchesQuery && matchesFilter;
    });
  }, [data.items, filter, query]);

  const targetIds = selectedIds.size > 0 ? Array.from(selectedIds) : data.items.map((item) => item.botId);

  const runBulkPatch = (action: string, patch: Record<string, unknown>) => {
    setErrorMessage(null);
    setPendingAction(action);
    startTransition(async () => {
      try {
        const response = await fetch('/api/admin/morning-briefings', {
          body: JSON.stringify({
            botInstanceIds: selectedIds.size > 0 ? targetIds : undefined,
            patch,
            scope: selectedIds.size > 0 ? 'selected' : 'all',
          }),
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        });
        const payload = (await response.json()) as ApiResponse<AdminMorningBriefingPayload>;

        if (!response.ok || !payload.data) {
          setErrorMessage(payload.error?.message ?? t((messages) => messages.adminMorningBriefings.commandFailed));
          return;
        }

        setData(payload.data);
        setSelectedIds(new Set());
      } catch {
        setErrorMessage(t((messages) => messages.adminMorningBriefings.commandFailed));
      } finally {
        setPendingAction(null);
      }
    });
  };

  const openEditor = (item: AdminMorningBriefingItem) => {
    setEditingItem(item);
    setEditor({
      deliveryTime: item.deliveryTime,
      forceEnabled: item.forceEnabled,
      location: item.location,
    });
  };

  const saveEditor = () => {
    if (!editingItem || !editor) {
      return;
    }

    if (!editor.location.trim() || !/^([01]\d|2[0-3]):[0-5]\d$/.test(editor.deliveryTime)) {
      setErrorMessage(t((messages) => messages.adminMorningBriefings.invalidEditor));
      return;
    }

    setErrorMessage(null);
    setPendingAction(`save:${editingItem.botId}`);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/admin/morning-briefings/${editingItem.botId}`, {
          body: JSON.stringify({
            deliveryTime: editor.deliveryTime,
            forceEnabled: editor.forceEnabled,
            location: editor.location.trim(),
            timezone: 'Asia/Shanghai',
          }),
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        });
        const payload = (await response.json()) as ApiResponse<AdminMorningBriefingItem>;

        if (!response.ok || !payload.data) {
          setErrorMessage(payload.error?.message ?? t((messages) => messages.adminMorningBriefings.commandFailed));
          return;
        }

        const updatedItem = payload.data;
        setData((current) => withUpdatedItem(current, updatedItem));
        setEditingItem(null);
        setEditor(null);
      } catch {
        setErrorMessage(t((messages) => messages.adminMorningBriefings.commandFailed));
      } finally {
        setPendingAction(null);
      }
    });
  };

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryMetric icon={<UsersRound className="h-4 w-4" />} label={t((messages) => messages.adminMorningBriefings.total)} value={data.summary.total} />
        <SummaryMetric icon={<CheckCircle2 className="h-4 w-4" />} label={t((messages) => messages.adminMorningBriefings.enabled)} value={data.summary.enabled} />
        <SummaryMetric icon={<AlertTriangle className="h-4 w-4" />} label={t((messages) => messages.adminMorningBriefings.needsAttention)} value={data.summary.needsAttention} />
        <SummaryMetric icon={<CalendarClock className="h-4 w-4" />} label={t((messages) => messages.adminMorningBriefings.pending)} value={data.summary.pending} />
      </div>

      <SectionCard
        contentClassName="grid gap-4"
        description={t((messages) => messages.adminMorningBriefings.policyDescription)}
        title={t((messages) => messages.adminMorningBriefings.policyTitle)}
      >
        <div className="rounded-[var(--radius-control)] border border-[color:var(--status-attention)]/25 bg-[color:var(--status-attention-soft)] px-4 py-3 text-sm leading-6 text-foreground">
          {t((messages) => messages.adminMorningBriefings.reconciliationNotice)}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={isPending || data.items.length === 0} onClick={() => runBulkPatch('enable', { adminEnabled: true })} type="button">
            {pendingAction === 'enable' ? t((messages) => messages.adminMorningBriefings.applying) : t((messages) => messages.adminMorningBriefings.enableTarget)}
          </Button>
          <Button disabled={isPending || data.items.length === 0} onClick={() => runBulkPatch('disable', { adminEnabled: false })} type="button" variant="outline">
            {pendingAction === 'disable' ? t((messages) => messages.adminMorningBriefings.applying) : t((messages) => messages.adminMorningBriefings.disableTarget)}
          </Button>
          <Button
            disabled={isPending || data.items.length === 0}
            onClick={() => runBulkPatch('defaults', { deliveryTime: '08:30', location: '北京', timezone: 'Asia/Shanghai' })}
            type="button"
            variant="outline"
          >
            <CloudSun className="h-4 w-4" />
            {pendingAction === 'defaults' ? t((messages) => messages.adminMorningBriefings.applying) : t((messages) => messages.adminMorningBriefings.applyDefaults)}
          </Button>
          <span className="self-center text-xs text-muted-foreground">
            {selectedIds.size > 0
              ? t((messages) => messages.adminMorningBriefings.selectedCount({ count: selectedIds.size }))
              : t((messages) => messages.adminMorningBriefings.allScope)}
          </span>
        </div>
      </SectionCard>

      {errorMessage ? <ErrorNotice>{errorMessage}</ErrorNotice> : null}

      <SectionCard
        contentClassName="grid gap-4"
        description={t((messages) => messages.adminMorningBriefings.listDescription)}
        title={t((messages) => messages.adminMorningBriefings.listTitle)}
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_15rem]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label={t((messages) => messages.adminMorningBriefings.searchLabel)}
              className="pl-10"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t((messages) => messages.adminMorningBriefings.searchPlaceholder)}
              value={query}
            />
          </label>
          <Select onValueChange={(value) => setFilter(value as Filter)} value={filter}>
            <SelectTrigger aria-label={t((messages) => messages.adminMorningBriefings.filterLabel)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t((messages) => messages.adminMorningBriefings.filterAll)}</SelectItem>
              <SelectItem value="enabled">{t((messages) => messages.adminMorningBriefings.filterEnabled)}</SelectItem>
              <SelectItem value="disabled">{t((messages) => messages.adminMorningBriefings.filterDisabled)}</SelectItem>
              <SelectItem value="attention">{t((messages) => messages.adminMorningBriefings.filterAttention)}</SelectItem>
              <SelectItem value="optedOut">{t((messages) => messages.adminMorningBriefings.filterOptedOut)}</SelectItem>
              <SelectItem value="pending">{t((messages) => messages.adminMorningBriefings.filterPending)}</SelectItem>
              <SelectItem value="error">{t((messages) => messages.adminMorningBriefings.filterError)}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {visibleItems.length === 0 ? (
          <p className="m-0 rounded-[var(--radius-panel)] border border-dashed border-[color:var(--border-soft)] bg-[color:var(--surface-muted)] px-4 py-6 text-sm text-muted-foreground">
            {t((messages) => messages.adminMorningBriefings.empty)}
          </p>
        ) : visibleItems.map((item) => {
          const runtime = getRuntimeStatusPresentation(item.runtimeStatus, locale);
          return (
            <article className="grid gap-4 rounded-[var(--radius-panel)] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4" data-morning-briefing-row="" key={item.botId}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <input
                    aria-label={t((messages) => messages.adminMorningBriefings.selectBot({ name: item.botName }))}
                    checked={selectedIds.has(item.botId)}
                    className="mt-1 h-4 w-4 accent-primary"
                    onChange={() => setSelectedIds(toggleSelection(selectedIds, item.botId))}
                    type="checkbox"
                  />
                  <div className="grid min-w-0 gap-1">
                    <strong className="truncate text-base font-semibold text-foreground">{item.botName}</strong>
                    <span className="truncate text-sm text-muted-foreground">{item.ownerEmail ?? item.botId}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <ScheduleBadge item={item} />
                  <Badge variant="neutral">
                    {item.adminEnabled ? t((messages) => messages.adminMorningBriefings.policyEnabled) : t((messages) => messages.adminMorningBriefings.policyDisabled)}
                  </Badge>
                  {item.observedUserOptOut ? <Badge variant="warning">{t((messages) => messages.adminMorningBriefings.employeeOptedOut)}</Badge> : null}
                  {item.forceEnabled ? <Badge variant="danger">{t((messages) => messages.adminMorningBriefings.forced)}</Badge> : null}
                  <Badge variant={runtime.tone === 'success' ? 'success' : runtime.tone === 'danger' ? 'danger' : runtime.tone === 'attention' ? 'warning' : 'neutral'}>{runtime.label}</Badge>
                  <SyncBadge item={item} />
                </div>
              </div>

              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
                <Metadata label={t((messages) => messages.adminMorningBriefings.location)} value={item.location} />
                <Metadata label={t((messages) => messages.adminMorningBriefings.deliveryTime)} value={`${item.deliveryTime} · ${item.timezone}`} />
                <Metadata label={t((messages) => messages.adminMorningBriefings.scheduleStatus)} value={scheduleStatusLabel(item, t)} />
                <Metadata label={t((messages) => messages.adminMorningBriefings.scheduledFor)} value={<LocalizedDateTime locale={locale} unavailableLabel={t((messages) => messages.common.unavailable)} value={item.centralScheduledFor} />} />
                <Metadata label={t((messages) => messages.adminMorningBriefings.lastDelivered)} value={<LocalizedDateTime locale={locale} unavailableLabel={t((messages) => messages.common.unavailable)} value={item.centralLastDeliveredAt} />} />
                <Metadata label={t((messages) => messages.adminMorningBriefings.syncStatus)} value={syncStatusLabel(item.syncStatus, t)} />
                <Metadata label={t((messages) => messages.adminMorningBriefings.revisions)} value={`${item.desiredRevision} / ${item.appliedRevision}`} />
                <Metadata label={t((messages) => messages.adminMorningBriefings.lastSync)} value={<LocalizedDateTime locale={locale} unavailableLabel={t((messages) => messages.common.unavailable)} value={item.lastSyncedAt} />} />
                <Metadata label={t((messages) => messages.adminMorningBriefings.lastError)} value={item.centralLastError ?? item.lastSyncError ?? t((messages) => messages.common.unavailable)} />
              </dl>

              <div className="flex justify-end">
                <Button disabled={isPending} onClick={() => openEditor(item)} type="button" variant="outline">
                  {t((messages) => messages.adminMorningBriefings.edit)}
                </Button>
              </div>
            </article>
          );
        })}
      </SectionCard>

      <Dialog onOpenChange={(open) => { if (!open) { setEditingItem(null); setEditor(null); } }} open={Boolean(editingItem)}>
        {editingItem && editor ? (
          <DialogContent>
            <div className="grid gap-2 pr-10">
              <DialogTitle>{t((messages) => messages.adminMorningBriefings.editTitle({ name: editingItem.botName }))}</DialogTitle>
              <DialogDescription>{t((messages) => messages.adminMorningBriefings.editDescription)}</DialogDescription>
            </div>
            <div className="grid gap-4">
              <label className="grid gap-2">
                <Label htmlFor="briefing-location">{t((messages) => messages.adminMorningBriefings.location)}</Label>
                <Input id="briefing-location" maxLength={80} onChange={(event) => setEditor({ ...editor, location: event.target.value })} value={editor.location} />
              </label>
              <label className="grid gap-2">
                <Label htmlFor="briefing-time">{t((messages) => messages.adminMorningBriefings.deliveryTime)}</Label>
                <Input id="briefing-time" onChange={(event) => setEditor({ ...editor, deliveryTime: event.target.value })} type="time" value={editor.deliveryTime} />
              </label>
              <label className="flex items-start gap-3 rounded-[var(--radius-control)] border border-[color:var(--border-soft)] p-3">
                <input checked={editor.forceEnabled} className="mt-1 h-4 w-4 accent-primary" onChange={(event) => setEditor({ ...editor, forceEnabled: event.target.checked })} type="checkbox" />
                <span className="grid gap-1 text-sm">
                  <strong>{t((messages) => messages.adminMorningBriefings.forceEnabled)}</strong>
                  <span className="leading-6 text-muted-foreground">{t((messages) => messages.adminMorningBriefings.forceEnabledDescription)}</span>
                </span>
              </label>
              <div className="flex justify-end gap-2">
                <Button onClick={() => { setEditingItem(null); setEditor(null); }} type="button" variant="outline">{t((messages) => messages.adminMorningBriefings.cancel)}</Button>
                <Button disabled={isPending} onClick={saveEditor} type="button">
                  {pendingAction?.startsWith('save:') ? t((messages) => messages.adminMorningBriefings.saving) : t((messages) => messages.adminMorningBriefings.save)}
                </Button>
              </div>
            </div>
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

function Metadata({ label, value }: { label: string; value: ReactNode }) {
  return <div className="grid gap-1"><dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-soft)]">{label}</dt><dd className="m-0 break-words text-sm text-foreground">{value}</dd></div>;
}

function SyncBadge({ item }: { item: AdminMorningBriefingItem }) {
  const { t } = useLocale();
  if (item.syncStatus === 'error' || item.lastSyncError) {
    return <Badge variant="danger">{t((messages) => messages.adminMorningBriefings.syncError)}</Badge>;
  }
  if (isPendingReconciliation(item)) {
    return <Badge variant="warning">{t((messages) => messages.adminMorningBriefings.awaitingReconciliation)}</Badge>;
  }
  return <Badge variant="success">{t((messages) => messages.adminMorningBriefings.synced)}</Badge>;
}

function isPendingReconciliation(item: AdminMorningBriefingItem) {
  return item.syncStatus !== 'synced' || item.desiredRevision !== item.appliedRevision;
}

function toggleSelection(current: Set<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

function withUpdatedItem(payload: AdminMorningBriefingPayload, updated: AdminMorningBriefingItem): AdminMorningBriefingPayload {
  const items = payload.items.map((item) => item.botId === updated.botId ? updated : item);
  return {
    items,
    summary: {
      enabled: items.filter((item) => item.scheduleStatus === 'scheduled').length,
      needsAttention: items.filter(requiresScheduleAttention).length,
      optedOut: items.filter((item) => item.observedUserOptOut).length,
      pending: items.filter(isPendingReconciliation).length,
      total: items.length,
    },
  };
}

function syncStatusLabel(status: string, t: ReturnType<typeof useLocale>['t']): string {
  if (status === 'synced') return t((messages) => messages.adminMorningBriefings.synced);
  if (status === 'error') return t((messages) => messages.adminMorningBriefings.syncError);
  return t((messages) => messages.adminMorningBriefings.awaitingReconciliation);
}

function ScheduleBadge({ item }: { item: AdminMorningBriefingItem }) {
  const { t } = useLocale();
  const label = scheduleStatusLabel(item, t);

  if (item.centralLastError) {
    return <Badge variant="danger">{label}</Badge>;
  }
  if (item.scheduleStatus === 'scheduled') {
    return <Badge variant="success">{label}</Badge>;
  }
  if (item.scheduleStatus === 'disabled' || item.scheduleStatus === 'unknown') {
    return <Badge variant="neutral">{label}</Badge>;
  }
  if (item.scheduleStatus === 'stale') {
    return <Badge variant="danger">{label}</Badge>;
  }
  return <Badge variant="warning">{label}</Badge>;
}

function requiresScheduleAttention(item: AdminMorningBriefingItem): boolean {
  return Boolean(item.centralLastError)
    || Boolean(item.lastSyncError)
    || item.scheduleStatus === 'cleanup-pending'
    || item.scheduleStatus === 'setup-required'
    || item.scheduleStatus === 'stale'
    || item.scheduleStatus === 'unknown';
}

function scheduleStatusLabel(
  item: AdminMorningBriefingItem,
  t: ReturnType<typeof useLocale>['t'],
): string {
  if (item.centralLastError) {
    if (resolveMorningBriefingDeliveryStatus(item.centralLastError) === 'waiting-for-conversation') {
      return t((messages) => messages.adminMorningBriefings.deliveryWaitingForConversation);
    }
    return t((messages) => messages.adminMorningBriefings.deliveryRetrying);
  }
  if (item.scheduleStatus === 'scheduled') {
    return t((messages) => messages.adminMorningBriefings.scheduleScheduled);
  }
  if (item.scheduleStatus === 'disabled') {
    return t((messages) => messages.adminMorningBriefings.disabled);
  }
  if (item.scheduleStatus === 'cleanup-pending') {
    return t((messages) => messages.adminMorningBriefings.scheduleCleanupPending);
  }
  if (item.scheduleStatus === 'stale') {
    return t((messages) => messages.adminMorningBriefings.scheduleStale);
  }
  if (item.scheduleStatus === 'setup-required') {
    return t((messages) => messages.adminMorningBriefings.scheduleSetupRequired);
  }
  return t((messages) => messages.adminMorningBriefings.scheduleUnknown);
}
