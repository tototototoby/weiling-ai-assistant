import { requireAdminRequestSession } from '@/lib/admin';
import { fail, ok } from '@/lib/api-error';
import { getRepositories } from '@/lib/repositories';
import { requestAdminWecomReconnect } from '@/lib/wecom-admin';

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireAdminRequestSession(request);
    return ok(await requestAdminWecomReconnect({
      repositories: getRepositories(),
      updatedByUserId: session.user.id,
    }));
  } catch (error) {
    return fail(error);
  }
}
