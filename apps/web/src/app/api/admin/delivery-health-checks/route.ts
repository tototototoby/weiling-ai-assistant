import { requireAdminRequestSession } from '@/lib/admin';
import { fail, ok } from '@/lib/api-error';
import { listDeliveryHealthChecks } from '@/lib/admin-configs';

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    return ok(await listDeliveryHealthChecks());
  } catch (error) {
    return fail(error);
  }
}
