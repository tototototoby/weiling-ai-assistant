import { requireAdminRequestSession } from '@/lib/admin';
import { fail } from '@/lib/api-error';
import { getBotDetail, listBotEvents, listBotEventsAfterCursor } from '@/lib/bot-service';
import { createBotStreamResponse } from '@/lib/sse';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    const { id } = await context.params;
    await getBotDetail(id);

    return createBotStreamResponse({
      botId: id,
      getBotDetail,
      listBotEvents,
      listBotEventsAfterCursor,
      signal: request.signal,
    });
  } catch (error) {
    return fail(error);
  }
}
