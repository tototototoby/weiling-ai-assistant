import { fail, ok, readJsonBody } from '@/lib/api-error';
import { requireGroupManager, updateGroupTask } from '@/lib/group-admin';

interface RouteContext {
  params: Promise<{ groupId: string; taskId: string }>;
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { groupId, taskId } = await context.params;
    const access = await requireGroupManager(request, groupId);
    return ok(await updateGroupTask({
      groupId,
      payload: await readJsonBody(request),
      taskId,
      updatedByUserId: access.session.user.id,
    }));
  } catch (error) {
    return fail(error);
  }
}
