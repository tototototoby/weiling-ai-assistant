'use client';

import { useState, useTransition } from 'react';
import { Link2Off, Save, Unplug } from 'lucide-react';
import { SectionCard } from '@/components/layout/section-card';
import { useLocale } from '@/components/providers/locale-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LocalizedDateTime } from '@/components/ui/localized-date-time';
import type { AdminWecomBotBinding } from '@/lib/wecom-admin';

interface ApiResponse<T> {
  data: T | null;
  error: { message: string } | null;
}

export function AdminBotWecomPanel({
  initialData,
}: {
  initialData: AdminWecomBotBinding;
}) {
  const { locale, t } = useLocale();
  const [data, setData] = useState(initialData);
  const [wecomUserId, setWecomUserId] = useState(initialData.wecomUserId);
  const [enabled, setEnabled] = useState(initialData.enabled);
  const [preferredForProactive, setPreferredForProactive] = useState(
    initialData.preferredForProactive,
  );
  const [pendingAction, setPendingAction] = useState<'delete' | 'save' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const changed = wecomUserId !== data.wecomUserId
    || enabled !== data.enabled
    || preferredForProactive !== data.preferredForProactive;

  const mutate = (action: 'delete' | 'save', request: () => Promise<Response>) => {
    setErrorMessage(null);
    setPendingAction(action);
    startTransition(async () => {
      try {
        const response = await request();
        const payload = await response.json() as ApiResponse<AdminWecomBotBinding>;
        if (!response.ok || !payload.data) {
          throw new Error(payload.error?.message
            ?? t((messages) => messages.adminWecom.commandFailed));
        }
        setData(payload.data);
        setWecomUserId(payload.data.wecomUserId);
        setEnabled(payload.data.enabled);
        setPreferredForProactive(payload.data.preferredForProactive);
      } catch (error) {
        setErrorMessage(error instanceof Error
          ? error.message
          : t((messages) => messages.adminWecom.commandFailed));
      } finally {
        setPendingAction(null);
      }
    });
  };

  const save = () => mutate('save', () => fetch(`/api/admin/bots/${data.botId}/wecom`, {
    body: JSON.stringify({ enabled, preferredForProactive, wecomUserId }),
    headers: { 'content-type': 'application/json' },
    method: 'PATCH',
  }));
  const unbind = () => mutate(
    'delete',
    () => fetch(`/api/admin/bots/${data.botId}/wecom`, { method: 'DELETE' }),
  );

  return (
    <SectionCard
      contentClassName="grid gap-5"
      description={t((messages) => messages.adminWecom.channelDescription)}
      title={t((messages) => messages.adminWecom.channelTitle)}
    >
      {errorMessage ? <ErrorNotice>{errorMessage}</ErrorNotice> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={data.bound ? (data.enabled ? 'success' : 'warning') : 'neutral'}>
          {data.bound
            ? (data.enabled
                ? t((messages) => messages.adminWecom.bindingEnabled)
                : t((messages) => messages.adminWecom.bindingDisabled))
            : t((messages) => messages.adminWecom.bindingUnbound)}
        </Badge>
        {data.employeeName ? (
          <span className="text-xs text-muted-foreground">
            {t((messages) => messages.adminWecom.optionalEmployee)} {data.employeeName}
          </span>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`wecom-user-${data.botId}`}>
          {t((messages) => messages.adminWecom.wecomUserId)}
        </Label>
        <Input
          id={`wecom-user-${data.botId}`}
          maxLength={128}
          onChange={(event) => setWecomUserId(event.target.value)}
          value={wecomUserId}
        />
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            type="checkbox"
          />
          {t((messages) => messages.adminWecom.enableBinding)}
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            checked={preferredForProactive}
            onChange={(event) => setPreferredForProactive(event.target.checked)}
            type="checkbox"
          />
          {t((messages) => messages.adminWecom.preferProactive)}
        </label>
      </div>

      <dl className="m-0 grid gap-2 border-t border-[color:var(--border-soft)] pt-4 text-xs text-muted-foreground sm:grid-cols-2">
        <div>
          <dt className="inline">{t((messages) => messages.adminWecom.lastInbound)} </dt>
          <dd className="m-0 inline">
            <LocalizedDateTime locale={locale} unavailableLabel={t((messages) => messages.common.unavailable)} value={data.lastInboundAt} />
          </dd>
        </div>
        <div>
          <dt className="inline">{t((messages) => messages.adminWecom.lastOutbound)} </dt>
          <dd className="m-0 inline">
            <LocalizedDateTime locale={locale} unavailableLabel={t((messages) => messages.common.unavailable)} value={data.lastOutboundAt} />
          </dd>
        </div>
      </dl>
      {data.lastError ? <span className="text-xs text-destructive">{data.lastError}</span> : null}

      <div className="flex flex-wrap justify-end gap-2 border-t border-[color:var(--border-soft)] pt-4">
        {data.bound ? (
          <Button disabled={isPending} onClick={unbind} type="button" variant="outline">
            {pendingAction === 'delete'
              ? <Unplug className="h-4 w-4" />
              : <Link2Off className="h-4 w-4" />}
            {pendingAction === 'delete'
              ? t((messages) => messages.adminWecom.unbinding)
              : t((messages) => messages.adminWecom.unbind)}
          </Button>
        ) : null}
        <Button
          disabled={isPending || !wecomUserId.trim() || (!changed && data.bound)}
          onClick={save}
          type="button"
        >
          <Save className="h-4 w-4" />
          {pendingAction === 'save'
            ? t((messages) => messages.adminWecom.saving)
            : t((messages) => messages.adminWecom.saveBinding)}
        </Button>
      </div>
    </SectionCard>
  );
}
