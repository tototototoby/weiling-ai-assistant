import { requireAdminRequestSession } from '@/lib/admin';
import { fail, ok, readJsonBody } from '@/lib/api-error';
import { testAdminRagflowConnection } from '@/lib/ragflow-admin';
import { getRepositories } from '@/lib/repositories';

export async function POST(request: Request): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    return ok(await testAdminRagflowConnection({
      payload: await readJsonBody(request),
      repositories: getRepositories(),
    }));
  } catch (error) {
    return fail(error);
  }
}
