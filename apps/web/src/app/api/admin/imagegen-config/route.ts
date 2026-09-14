import { requireAdminRequestSession } from '@/lib/admin';
import { fail, ok, readJsonBody } from '@/lib/api-error';
import { getImagegenConfig, updateImagegenConfig } from '@/lib/admin-configs';

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    return ok(await getImagegenConfig());
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const session = await requireAdminRequestSession(request);
    return ok(await updateImagegenConfig({
      payload: await readJsonBody(request),
      updatedByUserId: session.user.id,
    }));
  } catch (error) {
    return fail(error);
  }
}
