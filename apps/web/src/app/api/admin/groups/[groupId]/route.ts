import { requireAdminRequestSession } from '@/lib/admin';
import { fail, ok, readJsonBody } from '@/lib/api-error';
import { deleteAdminGroup, updateAdminGroup } from '@/lib/group-admin';

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    const { groupId } = await context.params;
    return ok(await updateAdminGroup({
      groupId,
      payload: await readJsonBody(request),
    }));
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    return ok(await deleteAdminGroup((await context.params).groupId));
  } catch (error) {
    return fail(error);
  }
}
