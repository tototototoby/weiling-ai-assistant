import { redirect } from 'next/navigation';
import { ChatSignInForm } from '@/components/chat/chat-sign-in-form';
import { getMessages, getRequestLocale } from '@/lib/locale';
import { getServerSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function ChatLoginPage() {
  const session = await getServerSession();
  if (session) {
    redirect('/chat');
  }

  const locale = await getRequestLocale();
  const messages = getMessages(locale);

  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="grid w-full max-w-md gap-6 rounded-[1.6rem] border border-[color:var(--border-soft)] bg-[color:var(--surface)]/92 p-8 shadow-[var(--shadow-panel)] backdrop-blur-xl">
        <div className="grid gap-2 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-[1rem] bg-primary text-2xl font-bold text-primary-foreground">
            {messages.chat.brandMark}
          </span>
          <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em] text-foreground">
            {messages.chat.title}
          </h1>
          <p className="m-0 text-sm text-muted-foreground">{messages.chat.loginHint}</p>
        </div>
        <ChatSignInForm />
      </div>
    </section>
  );
}
