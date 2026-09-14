import { requireAdminRequestSession } from '@/lib/admin';
import { fail, ok } from '@/lib/api-error';
import { updateAdminMorningBriefing } from '@/lib/morning-briefing-admin';
import { getRepositories } from '@/lib/repositories';

interface RouteContext {
  params: Promise<{ botId: string }>;
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    const { botId } = await context.params;
    return ok(await updateAdminMorningBriefing({
      botInstanceId: botId,
      payload: await request.json(),
      repositories: getRepositories(),
    }));
  } catch (error) {
    return fail(error);
  }
}
