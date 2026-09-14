'use client';

import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { useState, useTransition } from 'react';
import { useLocale } from '@/components/providers/locale-provider';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface RegisterWithInviteResponse {
  data: {
    user: {
      email: string;
      id: string;
      name: string;
    };
  } | null;
  error: {
    code: string;
    message: string;
  } | null;
}

function RequiredIndicator() {
  return (
    <span aria-hidden="true" className="text-[color:var(--text-soft)]" data-required-indicator="">
      {' *'}
    </span>
  );
}

export function SignUpForm() {
  const router = useRouter();
  const { t } = useLocale();
  const emailLabel = t((messages) => messages.auth.email);
  const passwordLabel = t((messages) => messages.auth.password);
  const inviteCodeLabel = t((messages) => messages.auth.inviteCode);
  const [email, setEmail] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    startTransition(async () => {
      try {
        const response = await fetch('/api/auth/register-with-invite', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            email,
            inviteCode,
            password,
          }),
        });

        const payload = await response.json() as RegisterWithInviteResponse;

        if (!response.ok || !payload.data?.user) {
          setErrorMessage(payload.error?.message ?? t((messages) => messages.auth.signUpFailed));
          return;
        }

        router.push('/');
        router.refresh();
      } catch {
        setErrorMessage(t((messages) => messages.auth.signUpFailed));
      }
    });
  };

  return (
    <form className="grid gap-6" onSubmit={handleSubmit}>
      <div className="grid gap-4">
        <Label className="grid gap-2.5 text-sm font-medium text-foreground">
          <span data-sign-up-label="">
            {emailLabel}
            <RequiredIndicator />
          </span>
          <Input
            aria-label={emailLabel}
            autoComplete="email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </Label>

        <Label className="grid gap-2.5 text-sm font-medium text-foreground">
          <span data-sign-up-label="">
            {passwordLabel}
            <RequiredIndicator />
          </span>
          <Input
            aria-label={passwordLabel}
            autoComplete="new-password"
            minLength={8}
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </Label>

        <Label className="grid gap-2.5 text-sm font-medium text-foreground">
          <span data-sign-up-label="">
            {inviteCodeLabel}
          </span>
          <Input
            aria-label={inviteCodeLabel}
            autoComplete="one-time-code"
            name="inviteCode"
            onChange={(event) => setInviteCode(event.target.value)}
            type="text"
            value={inviteCode}
          />
        </Label>
      </div>

      {errorMessage ? <ErrorNotice>{errorMessage}</ErrorNotice> : null}

      <Button className="w-full" disabled={isPending} size="lg" type="submit">
        {isPending ? t((messages) => messages.auth.signUpPending) : t((messages) => messages.auth.signUp)}
      </Button>
    </form>
  );
}
