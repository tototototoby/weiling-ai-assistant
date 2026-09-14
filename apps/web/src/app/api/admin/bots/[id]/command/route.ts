import { z } from 'zod';
import { requireAdminRequestSession } from '@/lib/admin';
import { ApiError, fail, ok } from '@/lib/api-error';
import { requestBotQrReissue, restartBot, startBot, stopBot } from '@/lib/bot-service';

const commandSchema = z.object({ action: z.enum(['reissue_qr', 'restart', 'start', 'stop']) }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    const { id } = await context.params;
    const parsed = commandSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ApiError({
        code: 'ADMIN_BOT_INVALID_COMMAND',
        message: 'Invalid admin bot command.',
        status: 400,
      });
    }
    const payload = parsed.data;
    const bot = payload.action === 'reissue_qr'
      ? await requestBotQrReissue(id)
      : payload.action === 'start'
      ? await startBot(id)
      : payload.action === 'stop'
        ? await stopBot(id)
        : await restartBot(id);

    return ok(bot);
  } catch (error) {
    return fail(error);
  }
}
