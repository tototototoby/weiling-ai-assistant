import { fail, ok } from '@/lib/api-error';
import { listMyTeam } from '@/lib/group-admin';
import { requireRequestSession } from '@/lib/session';

export async function GET(request: Request): Promise<Response> {
  try {
    const session = await requireRequestSession(request);
    return ok(await listMyTeam(session.user.id));
  } catch (error) {
    return fail(error);
  }
}
