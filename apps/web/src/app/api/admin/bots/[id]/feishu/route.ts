import { requireAdminRequestSession } from '@/lib/admin';
import { fail, ok, readJsonBody } from '@/lib/api-error';
import {
  deleteAdminBotFeishuConfig,
  getAdminBotFeishuConfig,
  updateAdminBotFeishuConfig,
} from '@/lib/feishu-admin';
import { getRepositories } from '@/lib/repositories';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    return ok(await getAdminBotFeishuConfig(
      (await context.params).id,
      getRepositories(),
    ));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const session = await requireAdminRequestSession(request);
    return ok(await updateAdminBotFeishuConfig({
      botId: (await context.params).id,
      payload: await readJsonBody(request),
      repositories: getRepositories(),
      updatedByUserId: session.user.id,
    }));
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const session = await requireAdminRequestSession(request);
    return ok(await deleteAdminBotFeishuConfig({
      botId: (await context.params).id,
      repositories: getRepositories(),
      updatedByUserId: session.user.id,
    }));
  } catch (error) {
    return fail(error);
  }
}
