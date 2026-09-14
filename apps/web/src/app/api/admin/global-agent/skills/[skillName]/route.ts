import { requireAdminRequestSession } from '@/lib/admin';
import { fail, ok } from '@/lib/api-error';
import { updateAdminGlobalAgentSkill } from '@/lib/global-agent-admin';
import { getRepositories } from '@/lib/repositories';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ skillName: string }> },
): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    const { skillName } = await context.params;
    return ok(await updateAdminGlobalAgentSkill({
      payload: await request.json(),
      repositories: getRepositories(),
      skillName,
    }));
  } catch (error) {
    return fail(error);
  }
}
