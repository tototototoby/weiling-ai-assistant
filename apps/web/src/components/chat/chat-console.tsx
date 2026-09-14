'use client';

import { useState } from 'react';
import { KeyRound, LogOut, MessageSquareText } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { WebChatPanel } from '@/components/bots/web-chat-panel';
import { useLocale } from '@/components/providers/locale-provider';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

interface ChatBotItem {
  id: string;
  name: string;
  provider: string;
  model: string;
  status: string;
}

interface ChatConsoleProps {
  bots: ChatBotItem[];
  email: string;
}

export function ChatConsole({ bots, email }: ChatConsoleProps) {
  const { t } = useLocale();
  const router = useRouter();
  const [selectedBotId, setSelectedBotId] = useState<string | null>(bots[0]?.id ?? null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const selectedBot = bots.find((bot) => bot.id === selectedBotId) ?? null;

  const changePassword = async () => {
    setPasswordError(null);
    setPasswordNotice(null);
    if (newPassword.length < 8) {
      setPasswordError(t((messages) => messages.chat.passwordTooShort));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t((messages) => messages.chat.passwordMismatch));
      return;
    }
    setIsSavingPassword(true);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
      });
      if (result.error) {
        setPasswordError(result.error.message ?? t((messages) => messages.chat.passwordChangeFailed));
        return;
      }
      setPasswordNotice(t((messages) => messages.chat.passwordChanged));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } finally {
      setIsSavingPassword(false);
    }
  };

  const signOut = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push('/chat/login');
          router.refresh();
        },
      },
    });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-20 border-b border-[color:var(--border-soft)] bg-[color:var(--app-bg)]/92 py-2 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1480px] items-center justify-between gap-3 px-4 py-2 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-primary text-sm font-bold text-primary-foreground">
              {t((messages) => messages.chat.brandMark)}
            </span>
            <div className="grid min-w-0 gap-0.5">
              <strong className="truncate text-sm font-semibold text-foreground">
                {t((messages) => messages.chat.title)}
              </strong>
              <span className="truncate text-xs text-muted-foreground">{email}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => setPasswordOpen(true)} size="sm" type="button" variant="outline">
              <KeyRound className="h-4 w-4" />
              {t((messages) => messages.chat.changePassword)}
            </Button>
            <Button onClick={() => void signOut()} size="sm" type="button" variant="outline">
              <LogOut className="h-4 w-4" />
              {t((messages) => messages.chat.signOut)}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1480px] flex-1 gap-4 px-4 py-4 lg:grid-cols-[260px_minmax(0,1fr)] lg:px-6">
        <aside className="grid content-start gap-2 rounded-[var(--radius-shell)] border border-[color:var(--border-soft)] bg-[color:var(--app-panel)] p-3 lg:sticky lg:top-20 lg:self-start">
          <strong className="px-2 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--text-soft)]">
            {t((messages) => messages.chat.myBots)}
          </strong>
          {bots.length === 0 ? (
            <p className="px-2 py-6 text-sm text-muted-foreground">
              {t((messages) => messages.chat.noBots)}
            </p>
          ) : (
            bots.map((bot) => (
              <button
                className={cn(
                  'flex items-center gap-2 rounded-[var(--radius-control)] px-3 py-2.5 text-left text-sm font-medium transition-[background-color,color]',
                  bot.id === selectedBotId
                    ? 'border border-[color:var(--border-soft)] bg-[color:var(--accent-soft)] text-foreground'
                    : 'border border-transparent bg-transparent text-muted-foreground hover:bg-[color:var(--surface-muted)] hover:text-foreground',
                )}
                key={bot.id}
                onClick={() => setSelectedBotId(bot.id)}
                type="button"
              >
                <MessageSquareText className="h-4 w-4 shrink-0" />
                <span className="truncate">{bot.name}</span>
              </button>
            ))
          )}
        </aside>

        <section className="grid min-h-[28rem] content-start gap-4">
          {selectedBot ? (
            <WebChatPanel botId={selectedBot.id} />
          ) : (
            <div className="grid min-h-[24rem] place-items-center rounded-[var(--radius-shell)] border border-[color:var(--border-soft)] bg-[color:var(--app-panel)] p-8 text-center">
              <p className="text-sm text-muted-foreground">{t((messages) => messages.chat.selectBotHint)}</p>
            </div>
          )}
        </section>
      </main>

      <Dialog onOpenChange={(open) => {
        setPasswordOpen(open);
        if (!open) {
          setPasswordError(null);
          setPasswordNotice(null);
        }
      }} open={passwordOpen}>
        <DialogContent className="grid gap-4">
          <div className="grid gap-2 pr-8">
            <DialogTitle>{t((messages) => messages.chat.changePassword)}</DialogTitle>
            <DialogDescription>{t((messages) => messages.chat.changePasswordHint)}</DialogDescription>
          </div>
          {passwordNotice ? (
            <p className="rounded-[1.2rem] border border-[color:var(--status-success)]/16 bg-[color:var(--status-success-soft)] px-4 py-3 text-sm leading-6 text-[color:var(--status-success)]">
              {passwordNotice}
            </p>
          ) : null}
          {passwordError ? <ErrorNotice>{passwordError}</ErrorNotice> : null}
          <div className="grid gap-3">
            <Label className="grid gap-1.5 text-sm text-foreground">
              {t((messages) => messages.chat.currentPassword)}
              <Input
                onChange={(event) => setCurrentPassword(event.target.value)}
                type="password"
                value={currentPassword}
              />
            </Label>
            <Label className="grid gap-1.5 text-sm text-foreground">
              {t((messages) => messages.chat.newPassword)}
              <Input
                minLength={8}
                onChange={(event) => setNewPassword(event.target.value)}
                type="password"
                value={newPassword}
              />
            </Label>
            <Label className="grid gap-1.5 text-sm text-foreground">
              {t((messages) => messages.chat.confirmPassword)}
              <Input
                minLength={8}
                onChange={(event) => setConfirmPassword(event.target.value)}
                type="password"
                value={confirmPassword}
              />
            </Label>
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setPasswordOpen(false)} type="button" variant="outline">
              {t((messages) => messages.chat.cancel)}
            </Button>
            <Button disabled={isSavingPassword} onClick={() => void changePassword()} type="button">
              {isSavingPassword ? t((messages) => messages.chat.saving) : t((messages) => messages.chat.save)}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
