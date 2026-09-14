import { requireAdminRequestSession } from '@/lib/admin';
import { fail, ok } from '@/lib/api-error';
import { deleteBot } from '@/lib/bot-service';

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    return ok(await deleteBot((await context.params).id));
  } catch (error) {
    return fail(error);
  }
}
