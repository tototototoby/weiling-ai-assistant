import { requireAdminRequestSession } from '@/lib/admin';
import { fail, ok, readJsonBody } from '@/lib/api-error';
import { getRepositories } from '@/lib/repositories';
import { resetAdminWecomOnboardingSession } from '@/lib/wecom-admin';

export async function POST(request: Request): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    return ok(await resetAdminWecomOnboardingSession({
      payload: await readJsonBody(request),
      repositories: getRepositories(),
    }));
  } catch (error) {
    return fail(error);
  }
}
