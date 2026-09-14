import { requireAdminRequestSession } from '@/lib/admin';
import { fail, ok, readJsonBody } from '@/lib/api-error';
import {
  createAdminMessageBatch,
  listAdminMessages,
  updateAdminMessageConfig,
} from '@/lib/admin-messages';
import { getRepositories } from '@/lib/repositories';

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    return ok(await listAdminMessages(getRepositories()));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireAdminRequestSession(request);
    return ok(await createAdminMessageBatch({
      createdByUserId: session.user.id,
      payload: await readJsonBody(request),
      repositories: getRepositories(),
    }));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const session = await requireAdminRequestSession(request);
    return ok(await updateAdminMessageConfig({
      payload: await readJsonBody(request),
      repositories: getRepositories(),
      updatedByUserId: session.user.id,
    }));
  } catch (error) {
    return fail(error);
  }
}
