'use client';

import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { useState, useTransition } from 'react';
import { useLocale } from '@/components/providers/locale-provider';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';

export function SignInForm() {
  const router = useRouter();
  const { t } = useLocale();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    startTransition(async () => {
      const result = await authClient.signIn.email({
        email,
        password,
      });

      if (result.error) {
        setErrorMessage(result.error.message ?? t((messages) => messages.auth.signInFailed));
        return;
      }

      router.push('/');
      router.refresh();
    });
  };

  return (
    <form className="grid gap-6" onSubmit={handleSubmit}>
      <div className="grid gap-4">
        <Label className="grid gap-2.5 text-sm font-medium text-foreground">
          {t((messages) => messages.auth.email)}
          <Input
            autoComplete="email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </Label>

        <Label className="grid gap-2.5 text-sm font-medium text-foreground">
          {t((messages) => messages.auth.password)}
          <Input
            autoComplete="current-password"
            minLength={8}
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </Label>
      </div>

      {errorMessage ? <ErrorNotice>{errorMessage}</ErrorNotice> : null}

      <Button className="w-full" disabled={isPending} size="lg" type="submit">
        {isPending ? t((messages) => messages.auth.signInPending) : t((messages) => messages.auth.signIn)}
      </Button>
    </form>
  );
}
