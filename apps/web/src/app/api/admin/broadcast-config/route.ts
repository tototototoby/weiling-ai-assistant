import { requireAdminRequestSession } from '@/lib/admin';
import { fail, ok, readJsonBody } from '@/lib/api-error';
import { getBroadcastConfig, updateBroadcastConfig } from '@/lib/admin-configs';

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    return ok(await getBroadcastConfig());
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const session = await requireAdminRequestSession(request);
    return ok(await updateBroadcastConfig({
      payload: await readJsonBody(request),
      updatedByUserId: session.user.id,
    }));
  } catch (error) {
    return fail(error);
  }
}
