import { requireAdminRequestSession } from '@/lib/admin';
import { fail, ok } from '@/lib/api-error';
import { listAdminDify, updateAdminDify } from '@/lib/dify-admin';
import { getRepositories } from '@/lib/repositories';

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    return ok(await listAdminDify(getRepositories()));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const session = await requireAdminRequestSession(request);
    return ok(await updateAdminDify({
      payload: await request.json(),
      repositories: getRepositories(),
      updatedByUserId: session.user.id,
    }));
  } catch (error) {
    return fail(error);
  }
}
