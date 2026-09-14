import { fail, ok, readJsonBody } from '@/lib/api-error';
import { submitMyTask } from '@/lib/group-admin';
import { requireRequestSession } from '@/lib/session';

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const session = await requireRequestSession(request);
    return ok(await submitMyTask({
      payload: await readJsonBody(request),
      taskId: (await context.params).taskId,
      userId: session.user.id,
    }));
  } catch (error) {
    return fail(error);
  }
}
