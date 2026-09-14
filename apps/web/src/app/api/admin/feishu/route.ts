import { requireAdminRequestSession } from '@/lib/admin';
import { fail, ok } from '@/lib/api-error';
import { listAdminFeishu } from '@/lib/feishu-admin';
import { getRepositories } from '@/lib/repositories';

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    return ok(await listAdminFeishu(getRepositories()));
  } catch (error) {
    return fail(error);
  }
}
