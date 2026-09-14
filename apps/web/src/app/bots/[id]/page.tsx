import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BotDetailLiveView } from '@/components/bots/bot-detail-live-view';
import { WebChatPanel } from '@/components/bots/web-chat-panel';
import { Button } from '@/components/ui/button';
import { getBotDetail, listBotEvents } from '@/lib/bot-service';
import { listUserLlmProfiles } from '@/lib/llm-profiles';
import { getMessages, getRequestLocale } from '@/lib/locale';
import { ApiError } from '@/lib/api-error';
import { requireOwnedBot, requireServerSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

interface BotDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function BotDetailPage({ params }: BotDetailPageProps) {
  const locale = await getRequestLocale();
  const messages = getMessages(locale);
  const { id } = await params;
  const session = await requireServerSession();

  try {
    await requireOwnedBot(id, session.user.id);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
      notFound();
    }

    throw error;
  }

  const [bot, events, profiles] = await Promise.all([
    getBotDetail(id),
    listBotEvents(id),
    listUserLlmProfiles(session.user.id),
  ]);

  return (
    <section className="grid gap-8">
      <div className="flex justify-end">
        <Button asChild type="button" variant="outline">
          <Link href="/bots">{messages.botDetail.backToBots}</Link>
        </Button>
      </div>

      <BotDetailLiveView initialBot={bot} initialEvents={events} profiles={profiles} />

      <WebChatPanel botId={id} />
    </section>
  );
}
