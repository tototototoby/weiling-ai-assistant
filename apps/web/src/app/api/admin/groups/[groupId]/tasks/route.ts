import { fail, ok, readJsonBody } from '@/lib/api-error';
import { createGroupTask, listGroupTasks, requireGroupManager } from '@/lib/group-admin';

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    await requireGroupManager(request, (await context.params).groupId);
    return ok(await listGroupTasks((await context.params).groupId));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { groupId } = await context.params;
    const access = await requireGroupManager(request, groupId);
    return ok(await createGroupTask({
      currentEmployeeId: access.employeeId,
      currentUserId: access.session.user.id,
      groupId,
      payload: await readJsonBody(request),
    }), 201);
  } catch (error) {
    return fail(error);
  }
}
