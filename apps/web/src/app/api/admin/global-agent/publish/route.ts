import { requireAdminRequestSession } from '@/lib/admin';
import { fail, ok } from '@/lib/api-error';
import { republishAdminGlobalAgent } from '@/lib/global-agent-admin';
import { getRepositories } from '@/lib/repositories';

export async function POST(request: Request): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    return ok(await republishAdminGlobalAgent(getRepositories()));
  } catch (error) {
    return fail(error);
  }
}
