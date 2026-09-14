import { fail, ok } from '@/lib/api-error';
import { listMyTasks } from '@/lib/group-admin';
import { requireRequestSession } from '@/lib/session';

export async function GET(request: Request): Promise<Response> {
  try {
    const session = await requireRequestSession(request);
    return ok(await listMyTasks(session.user.id));
  } catch (error) {
    return fail(error);
  }
}
