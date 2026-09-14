import { requireAdminRequestSession } from '@/lib/admin';
import {
  getAdminBotAgentConfig,
  restoreAdminBotAgentConfig,
  updateAdminBotAgentConfig,
} from '@/lib/admin-bot-agent-config';
import { fail, ok } from '@/lib/api-error';
import { getRepositories } from '@/lib/repositories';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    const { id } = await context.params;
    return ok(await getAdminBotAgentConfig(id, getRepositories()));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const session = await requireAdminRequestSession(request);
    const { id } = await context.params;
    return ok(await updateAdminBotAgentConfig({
      administratorEmail: session.user.email,
      botInstanceId: id,
      payload: await request.json(),
      repositories: getRepositories(),
    }));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const session = await requireAdminRequestSession(request);
    const { id } = await context.params;
    return ok(await restoreAdminBotAgentConfig({
      administratorEmail: session.user.email,
      botInstanceId: id,
      payload: await request.json(),
      repositories: getRepositories(),
    }));
  } catch (error) {
    return fail(error);
  }
}
