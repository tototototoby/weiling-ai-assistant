import { fail, ok } from '@/lib/api-error';
import { requireAdminRequestSession } from '@/lib/admin';
import { getRepositories } from '@/lib/repositories';
import { updateAdminSandboxRuntimePool } from '@/lib/sandbox-runtime-admin';

interface RouteContext {
  params: Promise<{ botInstanceId: string }> | { botInstanceId: string };
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    const { botInstanceId } = await context.params;

    return ok(await updateAdminSandboxRuntimePool({
      botInstanceId,
      payload: await readJsonBody(request),
      repositories: getRepositories(),
    }));
  } catch (error) {
    return fail(error);
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
