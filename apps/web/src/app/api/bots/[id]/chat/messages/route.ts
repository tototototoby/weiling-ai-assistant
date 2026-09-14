import { WebChatMessageRepository } from '@weiling-ai/db';
import { fail, ok } from '@/lib/api-error';
import { getDatabaseClient } from '@/lib/repositories';
import { requireOwnedBot, requireRequestSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const session = await requireRequestSession(_request);
    const { id } = await context.params;
    await requireOwnedBot(id, session.user.id);

    const repository = new WebChatMessageRepository(getDatabaseClient().db);
    const messages = await repository.listByBotInstanceId(id, 50);

    return ok({
      messages: messages.map((message) => ({
        content: message.content,
        createdAt: message.createdAt.toISOString(),
        id: message.id,
        role: message.role,
        toolEventsJson: message.toolEventsJson,
      })),
    });
  } catch (error) {
    return fail(error);
  }
}
