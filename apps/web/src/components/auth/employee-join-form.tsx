'use client';

import { type FormEvent, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLocale } from '@/components/providers/locale-provider';

export function EmployeeJoinForm({ token }: { token: string }) {
  const { t } = useLocale();
  const messages = {
    name: t((items) => items.employeeOnboarding.nameOrNickname),
    failed: t((items) => items.employeeOnboarding.joinFailed),
    retry: t((items) => items.employeeOnboarding.joinRetry),
    pending: t((items) => items.employeeOnboarding.joinPending),
    action: t((items) => items.employeeOnboarding.joinAction),
  };
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/join/${encodeURIComponent(token)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        const payload = await response.json() as {
          data: { botId: string; publicUrl: string } | null;
          error: { message: string } | null;
        };
        if (!response.ok || !payload.data) {
          setError(payload.error?.message ?? messages.failed);
          return;
        }
        window.location.assign(toSameOriginQrShareUrl(payload.data.publicUrl, window.location.origin));
      } catch {
        setError(messages.retry);
      }
    });
  }

  return (
    <form className="grid gap-5" onSubmit={submit}>
      <Label className="grid gap-2.5 text-sm font-medium">
        {messages.name} <span aria-hidden="true" className="text-destructive">*</span>
        <Input
          aria-label={messages.name}
          autoComplete="name"
          maxLength={100}
          onChange={(event) => setName(event.target.value)}
          required
          value={name}
        />
      </Label>
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      <Button disabled={isPending || !name.trim()} size="lg" type="submit">
        {isPending ? messages.pending : messages.action}
      </Button>
    </form>
  );
}

export function toSameOriginQrShareUrl(publicUrl: string, currentOrigin: string): string {
  const target = new URL(publicUrl);
  if (!target.pathname.startsWith('/share/qr/')) {
    throw new TypeError('Employee onboarding returned an unexpected share URL.');
  }

  const sameOriginTarget = new URL('/', currentOrigin);
  sameOriginTarget.pathname = target.pathname;
  sameOriginTarget.search = target.search;
  sameOriginTarget.hash = target.hash;
  return sameOriginTarget.toString();
}
