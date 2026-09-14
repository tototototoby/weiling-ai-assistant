import { requireAdminRequestSession } from '@/lib/admin';
import { fail, ok } from '@/lib/api-error';
import { testAdminDifyConnection } from '@/lib/dify-admin';
import { getRepositories } from '@/lib/repositories';

export async function POST(request: Request): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    return ok(await testAdminDifyConnection({
      payload: await request.json(),
      repositories: getRepositories(),
    }));
  } catch (error) {
    return fail(error);
  }
}
