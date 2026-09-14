import { requireAdminRequestSession } from '@/lib/admin';
import { fail, ok, readJsonBody } from '@/lib/api-error';
import { listGroupMembers, updateGroupMembers } from '@/lib/group-admin';

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    return ok(await listGroupMembers((await context.params).groupId));
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    return ok(await updateGroupMembers({
      groupId: (await context.params).groupId,
      payload: await readJsonBody(request),
    }));
  } catch (error) {
    return fail(error);
  }
}
