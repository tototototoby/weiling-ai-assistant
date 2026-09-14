import { requireAdminRequestSession } from '@/lib/admin';
import { fail, ok, readJsonBody } from '@/lib/api-error';
import { listAdminRagflow, updateAdminRagflow } from '@/lib/ragflow-admin';
import { getRepositories } from '@/lib/repositories';

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    return ok(await listAdminRagflow(getRepositories()));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const session = await requireAdminRequestSession(request);
    return ok(await updateAdminRagflow({
      payload: await readJsonBody(request),
      repositories: getRepositories(),
      updatedByUserId: session.user.id,
    }));
  } catch (error) {
    return fail(error);
  }
}
