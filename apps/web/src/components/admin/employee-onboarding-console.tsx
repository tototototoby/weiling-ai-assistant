'use client';

import { type FormEvent, useState, useTransition } from 'react';
import { Check, Copy, Link2, Plus, Power, Save, Trash2 } from 'lucide-react';
import { SectionCard } from '@/components/layout/section-card';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { EmployeeDirectoryItem, EmployeeInviteLinkItem } from '@/lib/employee-onboarding';
import { useLocale } from '@/components/providers/locale-provider';

export function EmployeeOnboardingConsole({
  appBaseUrl,
  employees,
  links,
}: {
  appBaseUrl: string;
  employees: EmployeeDirectoryItem[];
  links: EmployeeInviteLinkItem[];
}) {
  const [employeeItems, setEmployeeItems] = useState(employees);
  const [linkItems, setLinkItems] = useState(links);
  const [employeeDrafts, setEmployeeDrafts] = useState<Record<string, { companyEmail: string; legalName: string; nickname: string }>>(
    Object.fromEntries(employees.map((employee) => [employee.id, {
      legalName: employee.legalName ?? '',
      nickname: employee.nickname ?? '',
      companyEmail: employee.companyEmail ?? '',
    }])),
  );
  const [legalName, setLegalName] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { t } = useLocale();
  const messages = {
    linksTitle: t((items) => items.employeeOnboarding.linkTitle),
    linksDescription: t((items) => items.employeeOnboarding.linkDescription),
    generateLink: t((items) => items.employeeOnboarding.generateLink),
    noLinks: t((items) => items.employeeOnboarding.noLinks),
    usage: t((items) => items.employeeOnboarding.usage),
    active: t((items) => items.employeeOnboarding.active),
    inactive: t((items) => items.employeeOnboarding.inactive),
    copyLink: t((items) => items.employeeOnboarding.copyLink),
    disableLink: t((items) => items.employeeOnboarding.disableLink),
    enableLink: t((items) => items.employeeOnboarding.enableLink),
    rosterTitle: t((items) => items.employeeOnboarding.rosterTitle),
    rosterDescription: t((items) => items.employeeOnboarding.rosterDescription),
    legalName: t((items) => items.employeeOnboarding.legalName),
    nickname: t((items) => items.employeeOnboarding.nickname),
    addEmployee: t((items) => items.employeeOnboarding.addEmployee),
    emptyRoster: t((items) => items.employeeOnboarding.emptyRoster),
    claimed: t((items) => items.employeeOnboarding.claimed),
    available: t((items) => items.employeeOnboarding.available),
    saveEmployee: t((items) => items.employeeOnboarding.saveEmployee),
    disableEmployee: t((items) => items.employeeOnboarding.disableEmployee),
    enableEmployee: t((items) => items.employeeOnboarding.enableEmployee),
    deleteEmployee: t((items) => items.employeeOnboarding.deleteEmployee),
    operationFailed: t((items) => items.employeeOnboarding.operationFailed),
    operationRetry: t((items) => items.employeeOnboarding.operationRetry),
  };

  function addEmployee(event: FormEvent) {
    event.preventDefault();
    mutate('/api/admin/employees', 'POST', { legalName, nickname, enabled: true }, (item: EmployeeDirectoryItem) => {
      setEmployeeItems((current) => [item, ...current]);
      setEmployeeDrafts((current) => ({ ...current, [item.id]: {
        legalName: item.legalName ?? '',
        nickname: item.nickname ?? '',
        companyEmail: item.companyEmail ?? '',
      } }));
      setLegalName('');
      setNickname('');
    });
  }

  function createLink() {
    mutate('/api/admin/employee-invite-links', 'POST', undefined, (item: EmployeeInviteLinkItem) => {
      setLinkItems((current) => [item, ...current]);
    });
  }

  function mutate<T>(url: string, method: string, body: unknown, onSuccess: (data: T) => void) {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(url, {
          method,
          headers: body === undefined ? undefined : { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const payload = await response.json() as { data: T | null; error: { message: string } | null };
        if (!response.ok || !payload.data) {
          setError(payload.error?.message ?? messages.operationFailed);
          return;
        }
        onSuccess(payload.data);
      } catch {
        setError(messages.operationRetry);
      }
    });
  }

  return (
    <div className="grid gap-6">
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}

      <SectionCard contentClassName="grid gap-4" description={messages.linksDescription} title={messages.linksTitle}>
        <div><Button disabled={isPending} onClick={createLink} type="button"><Link2 className="h-4 w-4" />{messages.generateLink}</Button></div>
        <div className="grid gap-3">
          {linkItems.length === 0 ? <p className="text-sm text-muted-foreground">{messages.noLinks}</p> : linkItems.map((link) => {
            const url = `${appBaseUrl.replace(/\/$/, '')}/join/${link.token}`;
            return (
              <div className="grid gap-3 border-b border-[color:var(--border-soft)] py-3 md:grid-cols-[1fr_auto] md:items-center" key={link.id}>
                <div className="min-w-0">
                  <p className="m-0 break-all text-sm font-medium">{url}</p>
                  <p className="m-0 mt-1 text-xs text-muted-foreground">{messages.usage({ count: link.usageCount })} · {link.enabled ? messages.active : messages.inactive}</p>
                </div>
                <div className="flex gap-2">
                  <Button aria-label={messages.copyLink} onClick={async () => { await navigator.clipboard.writeText(url); setCopiedId(link.id); }} size="icon" type="button" variant="outline">
                    {copiedId === link.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                  <Button
                    aria-label={link.enabled ? messages.disableLink : messages.enableLink}
                    onClick={() => mutate(`/api/admin/employee-invite-links/${link.id}`, 'PATCH', { enabled: !link.enabled }, (updated: EmployeeInviteLinkItem) => setLinkItems((current) => current.map((item) => item.id === updated.id ? updated : item)))}
                    size="icon"
                    type="button"
                    variant="outline"
                  ><Power className="h-4 w-4" /></Button>
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard contentClassName="grid gap-5" description={messages.rosterDescription} title={messages.rosterTitle}>
        <form className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end" onSubmit={addEmployee}>
          <Label className="grid gap-2">{messages.legalName}<Input maxLength={100} onChange={(event) => setLegalName(event.target.value)} value={legalName} /></Label>
          <Label className="grid gap-2">{messages.nickname}<Input maxLength={100} onChange={(event) => setNickname(event.target.value)} value={nickname} /></Label>
          <Button disabled={isPending || (!legalName.trim() && !nickname.trim())} type="submit"><Plus className="h-4 w-4" />{messages.addEmployee}</Button>
        </form>
        <div className="grid gap-2">
          {employeeItems.length === 0 ? <p className="text-sm text-muted-foreground">{messages.emptyRoster}</p> : employeeItems.map((employee) => {
            const draft = employeeDrafts[employee.id] ?? { companyEmail: employee.companyEmail ?? '', legalName: employee.legalName ?? '', nickname: employee.nickname ?? '' };
            const updateDraft = (field: 'companyEmail' | 'legalName' | 'nickname', value: string) => setEmployeeDrafts((current) => ({
              ...current,
              [employee.id]: { ...draft, [field]: value },
            }));
            return (
            <div className="grid gap-3 border-b border-[color:var(--border-soft)] py-3 lg:grid-cols-[1fr_1fr_1.2fr_auto] lg:items-end" key={employee.id}>
              <div>
                <Label className="grid gap-1.5 text-xs text-muted-foreground">{messages.legalName}<Input disabled={Boolean(employee.claimedAt)} maxLength={100} onChange={(event) => updateDraft('legalName', event.target.value)} value={draft.legalName} /></Label>
                <p className="m-0 mt-1 text-xs text-muted-foreground">{employee.claimedAt ? messages.claimed : employee.enabled ? messages.available : messages.inactive}</p>
              </div>
              <Label className="grid gap-1.5 text-xs text-muted-foreground">{messages.nickname}<Input disabled={Boolean(employee.claimedAt)} maxLength={100} onChange={(event) => updateDraft('nickname', event.target.value)} value={draft.nickname} /></Label>
              <Label className="grid gap-1.5 text-xs text-muted-foreground">企业邮箱<Input maxLength={200} onChange={(event) => updateDraft('companyEmail', event.target.value)} placeholder="自动生成，可手工修改" type="email" value={draft.companyEmail} /></Label>
              <div className="flex gap-2">
                <Button
                  aria-label={messages.saveEmployee}
                  disabled={Boolean(employee.claimedAt) || (!draft.legalName.trim() && !draft.nickname.trim())}
                  onClick={() => mutate(`/api/admin/employees/${employee.id}`, 'PATCH', { companyEmail: draft.companyEmail.trim() || null, legalName: draft.legalName, nickname: draft.nickname, enabled: employee.enabled }, (updated: EmployeeDirectoryItem) => setEmployeeItems((current) => current.map((item) => item.id === updated.id ? updated : item)))}
                  size="icon"
                  type="button"
                  variant="outline"
                ><Save className="h-4 w-4" /></Button>
                <Button
                  disabled={Boolean(employee.claimedAt)}
                  onClick={() => mutate(`/api/admin/employees/${employee.id}`, 'PATCH', { companyEmail: employee.companyEmail, legalName: employee.legalName, nickname: employee.nickname, enabled: !employee.enabled }, (updated: EmployeeDirectoryItem) => setEmployeeItems((current) => current.map((item) => item.id === updated.id ? updated : item)))}
                  type="button"
                  variant="outline"
                  >{employee.enabled ? messages.disableEmployee : messages.enableEmployee}</Button>
                <Button
                  aria-label={messages.deleteEmployee}
                  onClick={() => mutate(`/api/admin/employees/${employee.id}`, 'DELETE', undefined, () => setEmployeeItems((current) => current.filter((item) => item.id !== employee.id)))}
                  size="icon"
                  type="button"
                  variant="destructive"
                ><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          );})}
        </div>
      </SectionCard>
    </div>
  );
}
