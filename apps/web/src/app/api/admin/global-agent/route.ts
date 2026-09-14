import { requireAdminRequestSession } from '@/lib/admin';
import { fail, ok } from '@/lib/api-error';
import {
  listAdminGlobalAgent,
  updateAdminGlobalAgentDocuments,
} from '@/lib/global-agent-admin';
import { getRepositories } from '@/lib/repositories';

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    return ok(await listAdminGlobalAgent(getRepositories()));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    return ok(await updateAdminGlobalAgentDocuments({
      payload: await request.json(),
      repositories: getRepositories(),
    }));
  } catch (error) {
    return fail(error);
  }
}
