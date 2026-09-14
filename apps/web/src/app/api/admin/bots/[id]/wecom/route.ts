import { requireAdminRequestSession } from '@/lib/admin';
import { fail, ok, readJsonBody } from '@/lib/api-error';
import { getRepositories } from '@/lib/repositories';
import {
  deleteAdminBotWecomBinding,
  getAdminBotWecomBinding,
  updateAdminBotWecomBinding,
} from '@/lib/wecom-admin';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    return ok(await getAdminBotWecomBinding(
      (await context.params).id,
      getRepositories(),
    ));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    return ok(await updateAdminBotWecomBinding({
      botId: (await context.params).id,
      payload: await readJsonBody(request),
      repositories: getRepositories(),
    }));
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    return ok(await deleteAdminBotWecomBinding({
      botId: (await context.params).id,
      repositories: getRepositories(),
    }));
  } catch (error) {
    return fail(error);
  }
}
