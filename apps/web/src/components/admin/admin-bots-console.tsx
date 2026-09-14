'use client';

import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Bot, CalendarClock, Search, Waypoints } from 'lucide-react';
import { SectionCard } from '@/components/layout/section-card';
import { useLocale } from '@/components/providers/locale-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LocalizedDateTime } from '@/components/ui/localized-date-time';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AdminBotItem, AdminBotsPayload } from '@/lib/admin-bots';
import { getDesiredStatePresentation, getRuntimeStatusPresentation, type PresentationTone } from '@/lib/bot-status-presentation';

type BotFilter = 'all' | 'briefing' | 'issues' | 'pending' | 'running';

export function AdminBotsConsole({ initialData }: { initialData: AdminBotsPayload }) {
  const { locale, t } = useLocale();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<BotFilter>('all');
  const items = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return initialData.items.filter((item) => {
      const matchesQuery = !normalized || [item.name, item.ownerEmail, item.provider, item.model, item.id]
        .some((value) => value?.toLowerCase().includes(normalized));
      const matchesFilter = filter === 'all'
        || (filter === 'running' && item.status === 'running')
        || (filter === 'issues' && (item.status === 'failed' || item.status === 'degraded'))
        || (filter === 'briefing' && item.morningBriefing.scheduleStatus === 'scheduled')
        || (filter === 'pending' && isBriefingPending(item));
      return matchesQuery && matchesFilter;
    });
  }, [filter, initialData.items, query]);

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Summary icon={<Bot className="h-4 w-4" />} label={t((messages) => messages.adminBots.total)} value={initialData.summary.total} />
        <Summary icon={<Waypoints className="h-4 w-4" />} label={t((messages) => messages.adminBots.running)} value={initialData.summary.running} />
        <Summary icon={<AlertTriangle className="h-4 w-4" />} label={t((messages) => messages.adminBots.unhealthy)} value={initialData.summary.unhealthy} />
        <Summary icon={<CalendarClock className="h-4 w-4" />} label={t((messages) => messages.adminBots.briefingEnabled)} value={initialData.summary.briefingEnabled} />
        <Summary icon={<CalendarClock className="h-4 w-4" />} label={t((messages) => messages.adminBots.pending)} value={initialData.summary.pendingReconciliation} />
      </div>

      <SectionCard contentClassName="grid gap-4" description={t((messages) => messages.adminBots.listDescription)} title={t((messages) => messages.adminBots.listTitle)}>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_15rem]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label={t((messages) => messages.adminBots.searchLabel)} className="pl-10" onChange={(event) => setQuery(event.target.value)} placeholder={t((messages) => messages.adminBots.searchPlaceholder)} value={query} />
          </label>
          <Select onValueChange={(value) => setFilter(value as BotFilter)} value={filter}>
            <SelectTrigger aria-label={t((messages) => messages.adminBots.filterLabel)}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t((messages) => messages.adminBots.filterAll)}</SelectItem>
              <SelectItem value="running">{t((messages) => messages.adminBots.filterRunning)}</SelectItem>
              <SelectItem value="issues">{t((messages) => messages.adminBots.filterIssues)}</SelectItem>
              <SelectItem value="briefing">{t((messages) => messages.adminBots.filterBriefing)}</SelectItem>
              <SelectItem value="pending">{t((messages) => messages.adminBots.filterPending)}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {items.length === 0 ? <p className="m-0 rounded-[var(--radius-panel)] border border-dashed border-[color:var(--border-soft)] p-6 text-sm text-muted-foreground">{t((messages) => messages.adminBots.empty)}</p> : (
          <div className="grid gap-2">
            {items.map((item) => {
              const runtime = getRuntimeStatusPresentation(item.status, locale);
              const desired = getDesiredStatePresentation(item.desiredState, locale);
              return (
                <article className="grid gap-3 rounded-[var(--radius-panel)] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 xl:grid-cols-[minmax(13rem,1.25fr)_minmax(10rem,0.85fr)_minmax(8rem,0.7fr)_minmax(12rem,1fr)_minmax(13rem,1fr)_auto] xl:items-center" data-admin-bot-row="" key={item.id}>
                  <div className="grid min-w-0 gap-1">
                    <strong className="truncate text-base font-semibold text-foreground">{item.name}</strong>
                    <span className="truncate text-sm text-muted-foreground">{item.ownerEmail ?? item.ownerUserId}</span>
                    <span className="text-xs text-muted-foreground"><LocalizedDateTime locale={locale} value={item.updatedAt} /></span>
                  </div>
                  <div className="flex flex-wrap gap-2"><Badge variant={toneToBadge(runtime.tone)}>{runtime.label}</Badge><Badge variant={toneToBadge(desired.tone)}>{desired.label}</Badge></div>
                  <div className="grid gap-0.5 text-sm"><span className="font-medium">{item.provider}</span><span className="text-muted-foreground">{item.model}</span></div>
                  <div className="grid gap-1 text-sm"><span>{item.morningBriefing.location} · {item.morningBriefing.deliveryTime}</span><BriefingScheduleBadge item={item} /></div>
                  <div className="grid gap-1 text-sm"><Badge className="w-fit" variant={isBriefingPending(item) ? 'warning' : 'success'}>{isBriefingPending(item) ? t((messages) => messages.adminBots.pending) : t((messages) => messages.adminBots.synced)}</Badge><span className="text-muted-foreground">{item.morningBriefing.desiredRevision} / {item.morningBriefing.appliedRevision}</span></div>
                  <Button asChild size="sm" variant="outline"><Link href={`/admin/bots/${item.id}`}>{t((messages) => messages.adminBots.open)}</Link></Button>
                </article>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function Summary({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return <dl className="grid gap-2 rounded-[var(--radius-panel)] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4"><dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-soft)]">{icon}{label}</dt><dd className="m-0 text-2xl font-semibold">{value}</dd></dl>;
}

function isBriefingPending(item: AdminBotItem) {
  return item.morningBriefing.syncStatus !== 'synced'
    || item.morningBriefing.desiredRevision !== item.morningBriefing.appliedRevision
    || Boolean(item.morningBriefing.centralLastError)
    || item.morningBriefing.scheduleStatus === 'cleanup-pending'
    || item.morningBriefing.scheduleStatus === 'setup-required'
    || item.morningBriefing.scheduleStatus === 'stale'
    || item.morningBriefing.scheduleStatus === 'unknown';
}

function BriefingScheduleBadge({ item }: { item: AdminBotItem }) {
  const { t } = useLocale();
  const status = item.morningBriefing.scheduleStatus;
  let label: string = t((messages) => messages.adminBots.briefingUnknown);
  let variant: 'danger' | 'neutral' | 'success' | 'warning' = 'neutral';

  if (item.morningBriefing.centralLastError) {
    label = t((messages) => messages.adminBots.briefingDeliveryRetrying);
    variant = 'danger';
  } else if (status === 'scheduled') {
    label = t((messages) => messages.adminBots.briefingOn);
    variant = 'success';
  } else if (status === 'disabled') {
    label = t((messages) => messages.adminBots.briefingOff);
  } else if (status === 'setup-required') {
    label = t((messages) => messages.adminBots.briefingSetupRequired);
    variant = 'warning';
  } else if (status === 'stale') {
    label = t((messages) => messages.adminBots.briefingStale);
    variant = 'danger';
  } else if (status === 'cleanup-pending') {
    label = t((messages) => messages.adminBots.briefingCleanupPending);
    variant = 'warning';
  }

  return <Badge className="w-fit" variant={variant}>{label}</Badge>;
}

function toneToBadge(tone: PresentationTone) {
  if (tone === 'success') return 'success';
  if (tone === 'danger') return 'danger';
  if (tone === 'attention') return 'warning';
  return 'neutral';
}
