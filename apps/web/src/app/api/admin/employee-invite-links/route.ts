import { fail, ok } from '@/lib/api-error';
import { requireAdminRequestSession } from '@/lib/admin';
import { createEmployeeInviteLink, listEmployeeInviteLinks } from '@/lib/employee-onboarding';

export async function GET(request: Request) {
  try {
    await requireAdminRequestSession(request);
    return ok(await listEmployeeInviteLinks());
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    const session = await requireAdminRequestSession(request);
    return ok(await createEmployeeInviteLink(session.user.id));
  } catch (error) { return fail(error); }
}
