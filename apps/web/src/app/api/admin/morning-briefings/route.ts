import { requireAdminRequestSession } from '@/lib/admin';
import { fail, ok } from '@/lib/api-error';
import {
  bulkUpdateAdminMorningBriefings,
  listAdminMorningBriefings,
} from '@/lib/morning-briefing-admin';
import { getRepositories } from '@/lib/repositories';

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    return ok(await listAdminMorningBriefings(getRepositories()));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    return ok(await bulkUpdateAdminMorningBriefings({
      payload: await request.json(),
      repositories: getRepositories(),
    }));
  } catch (error) {
    return fail(error);
  }
}
