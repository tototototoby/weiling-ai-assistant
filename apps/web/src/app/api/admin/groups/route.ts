import { requireAdminRequestSession } from '@/lib/admin';
import { fail, ok, readJsonBody } from '@/lib/api-error';
import { createAdminGroup, listAdminGroups } from '@/lib/group-admin';

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    return ok(await listAdminGroups());
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireAdminRequestSession(request);
    return ok(await createAdminGroup({
      createdByUserId: session.user.id,
      payload: await readJsonBody(request),
    }), 201);
  } catch (error) {
    return fail(error);
  }
}
