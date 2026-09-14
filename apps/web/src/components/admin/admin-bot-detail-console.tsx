'use client';

import type { ReactNode } from 'react';
import { useEffect, useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { BotEventsList } from '@/components/bots/bot-events-list';
import { AdminBotAgentConfigPanel } from './admin-bot-agent-config-panel';
import { AdminBotWecomPanel } from './admin-bot-wecom-panel';
import { BotQrShareControls } from '@/components/bots/bot-qr-share-controls';
import { QrCodePanel } from '@/components/bots/qr-code-panel';
import { SectionCard } from '@/components/layout/section-card';
import { useLocale } from '@/components/providers/locale-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { LocalizedDateTime } from '@/components/ui/localized-date-time';
import type { AdminBotDetailPayload } from '@/lib/admin-bots';
import type { BotDetailItem, BotEventItem } from '@/lib/bot-service';
import { getDesiredStatePresentation, getRuntimeStatusPresentation, type PresentationTone } from '@/lib/bot-status-presentation';

type Command = 'reissue_qr' | 'restart' | 'start' | 'stop';
type ConfirmAction = Command | 'delete';

export function AdminBotDetailConsole({ initialData }: { initialData: AdminBotDetailPayload }) {
  const { locale, t } = useLocale();
  const router = useRouter();
  const [bot, setBot] = useState(initialData.bot);
  const [events, setEvents] = useState(initialData.events);
  const [isQrSharePending, setIsQrSharePending] = useState(false);
  const [confirmCommand, setConfirmCommand] = useState<ConfirmAction | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [streamErrorMessage, setStreamErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const runtime = getRuntimeStatusPresentation(bot.status, locale);
  const desired = getDesiredStatePresentation(bot.desiredState, locale);
  const briefing = initialData.inventory.morningBriefing;
  const briefingSchedule = getBriefingSchedulePresentation(
    briefing.scheduleStatus,
    Boolean(briefing.centralLastError),
    t,
  );
  const shouldShowQr = bot.status === 'waiting_for_qr';
  const canDelete = bot.desiredState === 'stopped' && bot.status === 'stopped' && bot.processPid === null;

  useEffect(() => {
    if (typeof EventSource === 'undefined') return undefined;

    const eventSource = new EventSource(`/api/admin/bots/${initialData.bot.id}/stream`);
    const applyBotPayload = (event: Event) => {
      const nextBot = JSON.parse((event as MessageEvent<string>).data) as Partial<BotDetailItem>;
      setStreamErrorMessage(null);
      setBot((previous) => ({ ...previous, ...nextBot }));
    };
    const appendEvent = (event: Event) => {
      const nextEvent = JSON.parse((event as MessageEvent<string>).data) as BotEventItem;
      setStreamErrorMessage(null);
      setEvents((previous) => [nextEvent, ...previous.filter((item) => item.id !== nextEvent.id)]);
    };
    const applyStreamError = (event: Event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as { message?: string };
      setStreamErrorMessage(payload.message ?? 'Unexpected server error.');
    };

    eventSource.addEventListener('bot.status.updated', applyBotPayload);
    eventSource.addEventListener('bot.qrcode.updated', applyBotPayload);
    eventSource.addEventListener('bot.error.updated', applyBotPayload);
    eventSource.addEventListener('bot.event.created', appendEvent);
    eventSource.addEventListener('bot.stream.error', applyStreamError);

    return () => eventSource.close();
  }, [initialData.bot.id]);

  const runCommand = (command: Command) => {
    setErrorMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/admin/bots/${bot.id}/command`, {
          body: JSON.stringify({ action: command }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        });
        const payload = await response.json() as { data: BotDetailItem | null; error: { message: string } | null };
        if (!response.ok || !payload.data) {
          setErrorMessage(payload.error?.message ?? t((messages) => messages.adminBots.commandFailed));
          return;
        }
        setBot(payload.data);
        setConfirmCommand(null);
      } catch {
        setErrorMessage(t((messages) => messages.adminBots.commandFailed));
      }
    });
  };

  const deleteCurrentBot = () => {
    setErrorMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/admin/bots/${bot.id}`, { method: 'DELETE' });
        const payload = await response.json() as { data: { id: string } | null; error: { message: string } | null };
        if (!response.ok || !payload.data) {
          setErrorMessage(payload.error?.message ?? t((messages) => messages.adminBots.deleteBotFailed));
          return;
        }
        router.replace('/admin/bots');
      } catch {
        setErrorMessage(t((messages) => messages.adminBots.deleteBotFailed));
      }
    });
  };

  return (
    <div className="grid gap-6">
      {errorMessage ? <ErrorNotice>{errorMessage}</ErrorNotice> : null}
      {streamErrorMessage ? <ErrorNotice>{streamErrorMessage}</ErrorNotice> : null}
      <SectionCard contentClassName="grid gap-5" description={t((messages) => messages.adminBots.commandDescription)} title={t((messages) => messages.adminBots.runtimeControls)}>
        <div className="flex flex-wrap gap-2"><Badge variant={toneToBadge(runtime.tone)}>{runtime.label}</Badge><Badge variant={toneToBadge(desired.tone)}>{desired.label}</Badge></div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={isPending || bot.desiredState === 'running'} onClick={() => runCommand('start')} type="button">{t((messages) => messages.adminBots.start)}</Button>
          <Button disabled={isPending || bot.desiredState === 'stopped'} onClick={() => setConfirmCommand('stop')} type="button" variant="outline">{t((messages) => messages.adminBots.stop)}</Button>
          <Button disabled={isPending} onClick={() => setConfirmCommand('restart')} type="button" variant="outline">{t((messages) => messages.adminBots.restart)}</Button>
        </div>
      </SectionCard>

      <SectionCard
        contentClassName="grid gap-3"
        description={canDelete ? t((messages) => messages.adminBots.deleteBotDescription) : t((messages) => messages.adminBots.deleteBotStoppedOnly)}
        title={t((messages) => messages.adminBots.dangerZone)}
      >
        <div>
          <Button disabled={!canDelete || isPending} onClick={() => setConfirmCommand('delete')} type="button" variant="destructive">
            <Trash2 className="h-4 w-4" />
            {t((messages) => messages.adminBots.deleteBot)}
          </Button>
        </div>
      </SectionCard>

      <AdminBotAgentConfigPanel botId={initialData.bot.id} initialData={initialData.agentConfig} />

      <AdminBotWecomPanel initialData={initialData.wecomBinding} />

      <div className="grid gap-6 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
        <SectionCard contentClassName="grid gap-5" title={t((messages) => messages.botDetail.qrShareTitle)}>
          <QrCodePanel
            actions={(
              <Button
                disabled={isPending || isQrSharePending}
                onClick={() => setConfirmCommand('reissue_qr')}
                size="sm"
                type="button"
                variant="outline"
              >
                {t((messages) => messages.botDetail.reissueQr)}
              </Button>
            )}
            compact
            embedded
            qrCodeId={shouldShowQr ? bot.lastQrCodeId : null}
            qrCodeIssuedAt={shouldShowQr ? bot.qrCodeIssuedAt : null}
            qrCodeUrl={shouldShowQr ? bot.lastQrCodeUrl : null}
          />
          <BotQrShareControls
            apiBasePath={`/api/admin/bots/${bot.id}`}
            botId={bot.id}
            disabled={isPending}
            onPendingChange={setIsQrSharePending}
          />
        </SectionCard>
        <BotEventsList events={events} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard contentClassName="grid gap-3" title={t((messages) => messages.adminBots.identityTitle)}>
          <Metadata label={t((messages) => messages.adminBots.owner)} value={initialData.inventory.ownerEmail ?? initialData.inventory.ownerUserId} />
          <Metadata label={t((messages) => messages.adminBots.model)} value={`${bot.provider} / ${bot.model}`} />
          <Metadata label={t((messages) => messages.adminBots.weixinAccount)} value={bot.weixinAccountId ?? t((messages) => messages.common.unavailable)} />
          <Metadata label={t((messages) => messages.adminBots.lastHeartbeat)} value={<LocalizedDateTime locale={locale} unavailableLabel={t((messages) => messages.common.unavailable)} value={bot.heartbeatAt} />} />
          <Metadata label={t((messages) => messages.adminBots.lastError)} value={bot.lastErrorMessage ?? t((messages) => messages.common.unavailable)} />
        </SectionCard>
        <SectionCard contentClassName="grid gap-3" description={t((messages) => messages.adminBots.briefingDescription)} title={t((messages) => messages.adminBots.briefingTitle)}>
          <Metadata label={t((messages) => messages.adminBots.briefingState)} value={<Badge variant={briefingSchedule.variant}>{briefingSchedule.label}</Badge>} />
          <Metadata label={t((messages) => messages.adminBots.nextBriefing)} value={<LocalizedDateTime locale={locale} unavailableLabel={t((messages) => messages.common.unavailable)} value={briefing.centralScheduledFor} />} />
          <Metadata label={t((messages) => messages.adminBots.locationTime)} value={`${briefing.location} · ${briefing.deliveryTime} · ${briefing.timezone}`} />
          <Metadata label={t((messages) => messages.adminBots.employeePreference)} value={briefing.observedUserOptOut ? t((messages) => messages.adminBots.employeeOptedOut) : t((messages) => messages.adminBots.employeeActive)} />
          <Metadata label={t((messages) => messages.adminBots.syncState)} value={`${briefing.syncStatus} · ${briefing.desiredRevision} / ${briefing.appliedRevision}`} />
          <Metadata label={t((messages) => messages.adminBots.lastSync)} value={<LocalizedDateTime locale={locale} unavailableLabel={t((messages) => messages.common.unavailable)} value={briefing.lastSyncedAt} />} />
        </SectionCard>
      </div>

      <Dialog onOpenChange={(open) => { if (!open) setConfirmCommand(null); }} open={Boolean(confirmCommand)}>
        {confirmCommand ? <DialogContent><div className="grid gap-2 pr-10"><DialogTitle>{confirmCommand === 'delete' ? t((messages) => messages.adminBots.deleteBotConfirmTitle) : t((messages) => messages.adminBots.confirmTitle)}</DialogTitle><DialogDescription>{confirmCommand === 'delete' ? t((messages) => messages.adminBots.deleteBotConfirmDescription) : t((messages) => messages.adminBots.confirmDescription({ action: commandLabel(confirmCommand, t) }))}</DialogDescription></div><div className="flex justify-end gap-2"><Button onClick={() => setConfirmCommand(null)} type="button" variant="outline">{t((messages) => messages.adminBots.cancel)}</Button><Button disabled={isPending} onClick={() => confirmCommand === 'delete' ? deleteCurrentBot() : runCommand(confirmCommand)} type="button" variant={confirmCommand === 'delete' ? 'destructive' : 'default'}>{isPending ? (confirmCommand === 'delete' ? t((messages) => messages.adminBots.deleteBotPending) : t((messages) => messages.adminBots.commandPending)) : t((messages) => messages.adminBots.confirm)}</Button></div></DialogContent> : null}
      </Dialog>
    </div>
  );
}

function Metadata({ label, value }: { label: string; value: ReactNode }) {
  return <div className="grid gap-1 rounded-[var(--radius-control)] border border-[color:var(--border-soft)] bg-[color:var(--surface-muted)]/50 p-3"><dt className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-soft)]">{label}</dt><dd className="m-0 break-words text-sm">{value}</dd></div>;
}

function commandLabel(command: Command, t: ReturnType<typeof useLocale>['t']) {
  if (command === 'reissue_qr') return t((messages) => messages.botDetail.reissueQr);
  if (command === 'stop') return t((messages) => messages.adminBots.stop);
  if (command === 'restart') return t((messages) => messages.adminBots.restart);
  return t((messages) => messages.adminBots.start);
}

function toneToBadge(tone: PresentationTone) {
  if (tone === 'success') return 'success';
  if (tone === 'danger') return 'danger';
  if (tone === 'attention') return 'warning';
  return 'neutral';
}

function getBriefingSchedulePresentation(
  status: AdminBotDetailPayload['inventory']['morningBriefing']['scheduleStatus'],
  deliveryFailed: boolean,
  t: ReturnType<typeof useLocale>['t'],
): { label: string; variant: 'danger' | 'neutral' | 'success' | 'warning' } {
  if (deliveryFailed) {
    return { label: t((messages) => messages.adminBots.briefingDeliveryRetrying), variant: 'danger' };
  }
  if (status === 'scheduled') {
    return { label: t((messages) => messages.adminBots.briefingOn), variant: 'success' };
  }
  if (status === 'disabled') {
    return { label: t((messages) => messages.adminBots.briefingOff), variant: 'neutral' };
  }
  if (status === 'setup-required') {
    return { label: t((messages) => messages.adminBots.briefingSetupRequired), variant: 'warning' };
  }
  if (status === 'stale') {
    return { label: t((messages) => messages.adminBots.briefingStale), variant: 'danger' };
  }
  if (status === 'cleanup-pending') {
    return { label: t((messages) => messages.adminBots.briefingCleanupPending), variant: 'warning' };
  }
  return { label: t((messages) => messages.adminBots.briefingUnknown), variant: 'neutral' };
}
