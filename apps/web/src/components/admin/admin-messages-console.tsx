'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { Mail, MessageSquareMore, MessageSquareText, RotateCcw, Save, Send, UserRound, UsersRound } from 'lucide-react';
import { SectionCard } from '@/components/layout/section-card';
import { useLocale } from '@/components/providers/locale-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { LocalizedDateTime } from '@/components/ui/localized-date-time';
import {
  ADMIN_MESSAGE_ASSISTANT_NAME_MAX_LENGTH,
  ADMIN_MESSAGE_COPY_DEFAULTS,
  ADMIN_MESSAGE_COPY_KEYS,
  ADMIN_MESSAGE_COPY_MAX_LENGTH,
  type AdminMessageCopyConfig,
  type AdminMessageCopyKey,
  validateAdminMessageCopyValue,
} from '@/lib/admin-message-copy';
import type { AdminMessagesPayload } from '@/lib/admin-messages';

type Scope = 'all' | 'selected';

interface CopyFieldDefinition {
  key: AdminMessageCopyKey;
  multiline?: boolean;
}

const copyFieldGroups: Array<{ fields: CopyFieldDefinition[]; key: 'identity' | 'meal' | 'morning' | 'weixin' | 'wecom' | 'binding' }> = [
  { fields: [{ key: 'assistantName' }], key: 'identity' },
  { fields: [{ key: 'mealConsentPrompt', multiline: true }, { key: 'mealRainReminder', multiline: true }, { key: 'mealStandardReminder', multiline: true }], key: 'meal' },
  { fields: [{ key: 'morningBriefingIntro', multiline: true }], key: 'morning' },
  { fields: [{ key: 'processingAck', multiline: true }], key: 'weixin' },
  { fields: [{ key: 'wecomAck', multiline: true }, { key: 'wecomDuplicate', multiline: true }, { key: 'wecomCompleted', multiline: true }, { key: 'wecomFailure', multiline: true }, { key: 'wecomUnbound', multiline: true }, { key: 'wecomUnsupported', multiline: true }, { key: 'wecomGroupUnsupported', multiline: true }], key: 'wecom' },
  { fields: [{ key: 'wecomBindingNamePrompt', multiline: true }, { key: 'wecomBindingNameInvalid', multiline: true }, { key: 'wecomBindingSuccess', multiline: true }], key: 'binding' },
];

interface ApiResponse<T> {
  data: T | null;
  error: { message: string } | null;
}

export function AdminMessagesConsole({ initialData }: { initialData: AdminMessagesPayload }) {
  const { locale, t } = useLocale();
  const [data, setData] = useState(initialData);
  const [scope, setScope] = useState<Scope>('all');
  const [message, setMessage] = useState('');
  const [subject, setSubject] = useState('微Link · 微灵 AI 助手通知');
  const [channel, setChannel] = useState<'im' | 'email' | 'both'>('im');
  const [emailDraft, setEmailDraft] = useState(() => ({
    ...initialData.emailConfig,
    password: '',
  }));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [copyDraft, setCopyDraft] = useState<AdminMessageCopyConfig>(() => pickMessageCopy(initialData.config));
  const [configError, setConfigError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isConfigPending, startConfigTransition] = useTransition();
  const targetCount = scope === 'all' ? data.targets.length : selectedIds.size;
  const canSend = message.trim().length > 0 && message.trim().length <= 4_000 && targetCount > 0;
  const recent = useMemo(() => data.deliveries.slice(0, 100), [data.deliveries]);
  const copyValidationErrors = useMemo(() => new Map(ADMIN_MESSAGE_COPY_KEYS.map((key) => [
    key,
    validateAdminMessageCopyValue(key, copyDraft[key]),
  ]).filter((entry): entry is [AdminMessageCopyKey, NonNullable<typeof entry[1]>] => entry[1] !== null)), [copyDraft]);
  const copyDirty = ADMIN_MESSAGE_COPY_KEYS.some((key) => copyDraft[key] !== data.config[key]);

  useEffect(() => {
    const hasActiveDelivery = data.deliveries.some(
      (delivery) => delivery.status === 'pending' || delivery.status === 'delivering',
    ) || data.emailDeliveries.some(
      (delivery) => delivery.status === 'pending' || delivery.status === 'delivering',
    );
    const hasWaitingDeliveryToFinalize = !data.config.deferFailedUntilUserActive
      && data.deliveries.some((delivery) => delivery.status === 'waiting_for_user');
    if (!hasActiveDelivery && !hasWaitingDeliveryToFinalize) {
      return undefined;
    }

    let disposed = false;
    const refresh = async () => {
      try {
        const response = await fetch('/api/admin/messages');
        const payload = (await response.json()) as ApiResponse<AdminMessagesPayload>;
        if (!disposed && response.ok && payload.data) setData(payload.data);
      } catch {
        // The next interval will retry without interrupting the compose flow.
      }
    };
    const timer = setInterval(() => void refresh(), 2_500);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [data.config.deferFailedUntilUserActive, data.deliveries]);

  const submit = () => {
    setConfirmOpen(false);
    setSendError(null);
    startTransition(async () => {
      try {
        const response = await fetch('/api/admin/messages', {
          body: JSON.stringify({
            botInstanceIds: scope === 'selected' ? Array.from(selectedIds) : undefined,
            message: message.trim(),
            channel,
            subject: subject.trim(),
            scope,
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        });
        const payload = (await response.json()) as ApiResponse<AdminMessagesPayload>;
        if (!response.ok || !payload.data) {
          setSendError(payload.error?.message ?? t((messages) => messages.adminMessages.sendFailed));
          return;
        }
        setData(payload.data);
        setMessage('');
        setSelectedIds(new Set());
      } catch {
        setSendError(t((messages) => messages.adminMessages.sendFailed));
      }
    });
  };

  const saveConfig = (deferFailedUntilUserActive: boolean, copy: AdminMessageCopyConfig) => {
    setConfigError(null);
    startConfigTransition(async () => {
      try {
        const response = await fetch('/api/admin/messages', {
          body: JSON.stringify({ deferFailedUntilUserActive, ...copy }),
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        });
        const payload = (await response.json()) as ApiResponse<AdminMessagesPayload>;
        if (!response.ok || !payload.data) {
          setConfigError(payload.error?.message ?? t((messages) => messages.adminMessages.configFailed));
          return;
        }
        setData(payload.data);
        setCopyDraft(pickMessageCopy(payload.data.config));
      } catch {
        setConfigError(t((messages) => messages.adminMessages.configFailed));
      }
    });
  };

  const updateDeferredDelivery = (deferFailedUntilUserActive: boolean) => {
    saveConfig(deferFailedUntilUserActive, pickMessageCopy(data.config));
  };

  const saveMessageCopy = () => {
    if (copyValidationErrors.size > 0) return;
    saveConfig(data.config.deferFailedUntilUserActive, trimMessageCopy(copyDraft));
  };

  const saveEmailConfig = () => {
    setConfigError(null);
    startConfigTransition(async () => {
      try {
        const response = await fetch('/api/admin/messages', {
          body: JSON.stringify({
            ...pickMessageCopy(data.config),
            deferFailedUntilUserActive: data.config.deferFailedUntilUserActive,
            email: {
              enabled: emailDraft.enabled,
              password: emailDraft.password || undefined,
              senderEmail: emailDraft.senderEmail || null,
              senderName: emailDraft.senderName,
              smtpHost: emailDraft.smtpHost,
              smtpPort: Number(emailDraft.smtpPort),
              smtpSecurity: emailDraft.smtpSecurity,
            },
          }),
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        });
        const payload = (await response.json()) as ApiResponse<AdminMessagesPayload>;
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? '邮件配置保存失败');
        setData(payload.data);
        setEmailDraft({ ...payload.data.emailConfig, password: '' });
      } catch (error) {
        setConfigError(error instanceof Error ? error.message : '邮件配置保存失败');
      }
    });
  };

  return (
    <div className="grid gap-6">
      <SectionCard
        contentClassName="grid gap-4"
        description={t((messages) => messages.adminMessages.deliveryPolicyDescription)}
        title={t((messages) => messages.adminMessages.deliveryPolicyTitle)}
      >
        <label className="flex items-center gap-3 rounded-[var(--radius-control)] border border-[color:var(--border-soft)] px-3 py-3">
          <input
            aria-label={t((messages) => messages.adminMessages.deferFailed)}
            checked={data.config.deferFailedUntilUserActive}
            className="h-4 w-4"
            disabled={isConfigPending}
            onChange={(event) => updateDeferredDelivery(event.target.checked)}
            role="switch"
            type="checkbox"
          />
          <MessageSquareMore className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">
            {t((messages) => messages.adminMessages.deferFailed)}
          </span>
        </label>
      </SectionCard>

      <SectionCard
        contentClassName="grid gap-5"
        description={t((messages) => messages.adminMessages.composeDescription)}
        title={t((messages) => messages.adminMessages.composeTitle)}
      >
        <div className="inline-flex w-fit rounded-[var(--radius-control)] border border-[color:var(--border-soft)] bg-[color:var(--surface-muted)] p-1">
          <Button onClick={() => setScope('all')} size="sm" type="button" variant={scope === 'all' ? 'default' : 'ghost'}>
            <UsersRound className="h-4 w-4" />
            {t((messages) => messages.adminMessages.allUsers)}
          </Button>
          <Button onClick={() => setScope('selected')} size="sm" type="button" variant={scope === 'selected' ? 'default' : 'ghost'}>
            <UserRound className="h-4 w-4" />
            {t((messages) => messages.adminMessages.selectedUsers)}
          </Button>
        </div>

        {scope === 'selected' ? (
          <div className="grid max-h-72 gap-2 overflow-y-auto rounded-[var(--radius-control)] border border-[color:var(--border-soft)] p-3 md:grid-cols-2">
            {data.targets.map((target) => (
              <label className="flex min-w-0 items-center gap-3 rounded-[var(--radius-control)] px-2 py-2 hover:bg-[color:var(--surface-muted)]" key={target.botId}>
                <input
                  checked={selectedIds.has(target.botId)}
                  className="h-4 w-4"
                  onChange={(event) => setSelectedIds((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(target.botId); else next.delete(target.botId);
                    return next;
                  })}
                  type="checkbox"
                />
                <span className="min-w-0">
                  <strong className="block truncate text-sm">{target.botName}</strong>
                  <span className="block truncate text-xs text-muted-foreground">{target.companyEmail ?? target.ownerEmail ?? target.ownerUserId}</span>
                </span>
              </label>
            ))}
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-[180px_1fr]">
          <label className="grid gap-2 text-sm font-medium">发送渠道
            <select className="h-10 rounded-[var(--radius-control)] border border-input bg-background px-3 text-sm" onChange={(event) => setChannel(event.target.value as typeof channel)} value={channel}>
              <option value="im">微信 / 企业微信</option>
              <option value="email">企业邮箱</option>
              <option value="both">微信 + 企业邮箱</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium">邮件主题
            <input className="h-10 rounded-[var(--radius-control)] border border-input bg-background px-3 text-sm" maxLength={200} onChange={(event) => setSubject(event.target.value)} value={subject} />
          </label>
        </div>

        <label className="grid gap-2 text-sm font-medium">
          {t((messages) => messages.adminMessages.messageLabel)}
          <textarea
            className="min-h-32 w-full resize-y rounded-[var(--radius-control)] border border-input bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            maxLength={4_000}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={t((messages) => messages.adminMessages.messagePlaceholder)}
            value={message}
          />
          <span className="text-xs font-normal text-muted-foreground">{message.length} / 4000</span>
        </label>

        {sendError ? <ErrorNotice>{sendError}</ErrorNotice> : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            {t((messages) => messages.adminMessages.targetCount({ count: targetCount }))}
          </span>
          <Button disabled={!canSend || isPending} onClick={() => setConfirmOpen(true)} type="button">
            <Send className="h-4 w-4" />
            {isPending ? t((messages) => messages.adminMessages.sending) : t((messages) => messages.adminMessages.send)}
          </Button>
        </div>
      </SectionCard>

      <SectionCard contentClassName="grid gap-4" description="统一配置企业邮箱发件人。密码只写入服务器私有密钥文件，不会回显。" title="全局邮件配置">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex items-center gap-3 text-sm font-medium"><input checked={emailDraft.enabled} onChange={(event) => setEmailDraft((current) => ({ ...current, enabled: event.target.checked }))} type="checkbox" />启用邮件投递</label>
          <p className="m-0 text-sm text-muted-foreground">密码状态：{data.emailConfig.passwordConfigured ? '已配置' : '未配置'}</p>
          <label className="grid gap-2 text-sm font-medium">发件人邮箱<input className="h-10 rounded-[var(--radius-control)] border border-input bg-background px-3 text-sm" onChange={(event) => setEmailDraft((current) => ({ ...current, senderEmail: event.target.value }))} type="email" value={emailDraft.senderEmail ?? ''} /></label>
          <label className="grid gap-2 text-sm font-medium">发件人名称<input className="h-10 rounded-[var(--radius-control)] border border-input bg-background px-3 text-sm" onChange={(event) => setEmailDraft((current) => ({ ...current, senderName: event.target.value }))} value={emailDraft.senderName} /></label>
          <label className="grid gap-2 text-sm font-medium">SMTP 主机<input className="h-10 rounded-[var(--radius-control)] border border-input bg-background px-3 text-sm" onChange={(event) => setEmailDraft((current) => ({ ...current, smtpHost: event.target.value }))} value={emailDraft.smtpHost} /></label>
          <label className="grid gap-2 text-sm font-medium">SMTP 端口<input className="h-10 rounded-[var(--radius-control)] border border-input bg-background px-3 text-sm" min={1} onChange={(event) => setEmailDraft((current) => ({ ...current, smtpPort: Number(event.target.value) || 0 }))} type="number" value={emailDraft.smtpPort} /></label>
          <label className="grid gap-2 text-sm font-medium">安全模式<select className="h-10 rounded-[var(--radius-control)] border border-input bg-background px-3 text-sm" onChange={(event) => setEmailDraft((current) => ({ ...current, smtpSecurity: event.target.value as 'ssl' | 'starttls' }))} value={emailDraft.smtpSecurity}><option value="ssl">SSL</option><option value="starttls">STARTTLS</option></select></label>
          <label className="grid gap-2 text-sm font-medium">专用密码（留空保持不变）<input autoComplete="new-password" className="h-10 rounded-[var(--radius-control)] border border-input bg-background px-3 text-sm" onChange={(event) => setEmailDraft((current) => ({ ...current, password: event.target.value }))} type="password" value={emailDraft.password} /></label>
        </div>
        <div><Button disabled={isConfigPending} onClick={saveEmailConfig} type="button"><Mail className="h-4 w-4" />保存邮件配置</Button></div>
      </SectionCard>

      <SectionCard
        contentClassName="grid gap-6"
        description={t((messages) => messages.adminMessages.copyDescription)}
        title={t((messages) => messages.adminMessages.copyTitle)}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--border-soft)] pb-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={data.config.observedRevision === data.config.revision ? 'success' : 'warning'}>
              {data.config.observedRevision === data.config.revision
                ? t((messages) => messages.adminMessages.copySynced)
                : t((messages) => messages.adminMessages.copyPending)}
            </Badge>
            <span>{t((messages) => messages.adminMessages.copyRevision({ revision: data.config.revision }))}</span>
            <span>{t((messages) => messages.adminMessages.copyUpdated)} <LocalizedDateTime locale={locale} value={data.config.updatedAt} /></span>
            {data.config.updatedByEmail ? (
              <span>{t((messages) => messages.adminMessages.copyUpdatedBy({ email: data.config.updatedByEmail ?? '' }))}</span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={isConfigPending}
              onClick={() => setCopyDraft({ ...ADMIN_MESSAGE_COPY_DEFAULTS })}
              type="button"
              variant="outline"
            >
              <RotateCcw className="h-4 w-4" />
              {t((messages) => messages.adminMessages.restoreCopyDefaults)}
            </Button>
            <Button
              disabled={!copyDirty || copyValidationErrors.size > 0 || isConfigPending}
              onClick={saveMessageCopy}
              type="button"
            >
              <Save className="h-4 w-4" />
              {isConfigPending
                ? t((messages) => messages.adminMessages.savingCopy)
                : t((messages) => messages.adminMessages.saveCopy)}
            </Button>
          </div>
        </div>

        {copyFieldGroups.map((group) => (
          <fieldset className="grid gap-4 border-b border-[color:var(--border-soft)] pb-6 last:border-b-0 last:pb-0" key={group.key}>
            <legend className="mb-3 text-sm font-semibold">
              {t((messages) => messages.adminMessages.copyGroups[group.key])}
            </legend>
            <div className="grid gap-4 lg:grid-cols-2">
              {group.fields.map((field) => {
                const value = copyDraft[field.key];
                const characterLength = value.trim().length;
                const maxLength = getCopyMaxLength(field.key);
                const validationError = copyValidationErrors.get(field.key) ?? null;
                const invalid = validationError !== null;
                const fieldLabel = t((messages) => messages.adminMessages.copyFields[field.key]);
                const fieldId = `admin-message-copy-${field.key}`;
                const className = `w-full rounded-[var(--radius-control)] border bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring ${invalid ? 'border-destructive' : 'border-input'}`;
                return (
                  <label className={`grid gap-2 text-sm font-medium ${field.key === 'assistantName' ? 'lg:col-span-1' : ''}`} htmlFor={fieldId} key={field.key}>
                    {fieldLabel}
                    {field.multiline ? (
                      <textarea
                        aria-label={fieldLabel}
                        aria-invalid={invalid}
                        className={`${className} min-h-24 resize-y`}
                        id={fieldId}
                        onChange={(event) => setCopyDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                        value={value}
                      />
                    ) : (
                      <input
                        aria-label={fieldLabel}
                        aria-invalid={invalid}
                        className={className}
                        id={fieldId}
                        onChange={(event) => setCopyDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                        type="text"
                        value={value}
                      />
                    )}
                    <span className={invalid ? 'text-xs font-normal text-destructive' : 'text-xs font-normal text-muted-foreground'}>
                      {validationError === 'required'
                        ? t((messages) => messages.adminMessages.copyRequired)
                        : validationError === 'controlCharacters'
                          ? t((messages) => messages.adminMessages.copyInvalidCharacters)
                          : validationError === 'invalidTemplate'
                            ? t((messages) => messages.adminMessages.copyInvalidTemplate)
                            : t((messages) => messages.adminMessages.copyByteCount({ count: characterLength, max: maxLength }))}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}

        {configError ? <ErrorNotice>{configError}</ErrorNotice> : null}
      </SectionCard>

      {data.emailDeliveries.length > 0 ? <SectionCard contentClassName="grid gap-3" description="邮件队列与重试状态" title="邮件发送记录">
        {data.emailDeliveries.slice(0, 100).map((delivery) => <div className="grid gap-2 border-b border-[color:var(--border-soft)] py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto]" key={`${delivery.botId}:${delivery.createdAt}:${delivery.subject}`}>
          <div><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{delivery.botName}</strong><span className="text-xs text-muted-foreground">{delivery.recipientEmail}</span><DeliveryStatus label={delivery.status} status={delivery.status} /></div><p className="mt-2 text-sm">{delivery.subject}</p>{delivery.lastError ? <p className="text-xs text-destructive">{delivery.lastError}</p> : null}</div>
          <LocalizedDateTime locale={locale} value={delivery.updatedAt} />
        </div>)}
      </SectionCard> : null}

      <SectionCard
        contentClassName="grid gap-3"
        description={t((messages) => messages.adminMessages.historyDescription)}
        title={t((messages) => messages.adminMessages.historyTitle)}
      >
        {recent.length === 0 ? (
          <div className="grid justify-items-center gap-2 py-10 text-center text-muted-foreground">
            <MessageSquareText className="h-6 w-6" />
            <span className="text-sm">{t((messages) => messages.adminMessages.empty)}</span>
          </div>
        ) : recent.map((delivery) => (
          <div className="grid gap-2 border-b border-[color:var(--border-soft)] py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto]" data-admin-message-delivery="" key={`${delivery.batchId}:${delivery.botId}`}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm">{delivery.botName}</strong>
                <span className="text-xs text-muted-foreground">{delivery.ownerEmail}</span>
                <DeliveryStatus
                  label={delivery.status === 'waiting_for_user'
                    ? t((messages) => messages.adminMessages.waitingForUser)
                    : delivery.status}
                  status={delivery.status}
                />
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{delivery.message}</p>
              {delivery.lastError ? <p className="mt-1 text-xs text-destructive">{delivery.lastError}</p> : null}
            </div>
            <div className="text-xs text-muted-foreground md:text-right">
              <LocalizedDateTime locale={locale} value={delivery.updatedAt} />
              <div>{t((messages) => messages.adminMessages.attempts({ count: delivery.attemptCount }))}</div>
            </div>
          </div>
        ))}
      </SectionCard>

      <Dialog onOpenChange={setConfirmOpen} open={confirmOpen}>
        <DialogContent>
          <DialogTitle>{t((messages) => messages.adminMessages.confirmTitle)}</DialogTitle>
          <DialogDescription>{t((messages) => messages.adminMessages.confirmDescription({ count: targetCount }))}</DialogDescription>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirmOpen(false)} type="button" variant="outline">{t((messages) => messages.adminMessages.cancel)}</Button>
            <Button onClick={submit} type="button"><Send className="h-4 w-4" />{t((messages) => messages.adminMessages.confirm)}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DeliveryStatus({ label, status }: { label: string; status: string }) {
  return <Badge variant={status === 'sent' ? 'success' : status === 'failed' ? 'danger' : 'neutral'}>{label}</Badge>;
}

function pickMessageCopy(config: AdminMessagesPayload['config']): AdminMessageCopyConfig {
  return ADMIN_MESSAGE_COPY_KEYS.reduce((copy, key) => {
    copy[key] = config[key];
    return copy;
  }, {} as AdminMessageCopyConfig);
}

function trimMessageCopy(copy: AdminMessageCopyConfig): AdminMessageCopyConfig {
  return ADMIN_MESSAGE_COPY_KEYS.reduce((trimmed, key) => {
    trimmed[key] = copy[key].trim();
    return trimmed;
  }, {} as AdminMessageCopyConfig);
}

function getCopyMaxLength(key: AdminMessageCopyKey): number {
  return key === 'assistantName' ? ADMIN_MESSAGE_ASSISTANT_NAME_MAX_LENGTH : ADMIN_MESSAGE_COPY_MAX_LENGTH;
}
