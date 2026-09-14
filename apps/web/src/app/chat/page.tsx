import { ChatConsole } from '@/components/chat/chat-console';
import { listBots } from '@/lib/bot-service';
import { requireServerSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function ChatPage() {
  const session = await requireServerSession();
  const bots = await listBots(session.user.id);

  return (
    <ChatConsole
      bots={bots.map((bot) => ({
        id: bot.id,
        model: bot.model,
        name: bot.name,
        provider: bot.provider,
        status: bot.status,
      }))}
      email={session.user.email}
    />
  );
}
