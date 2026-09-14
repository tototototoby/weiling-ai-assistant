import { z } from 'zod';
import { ApiError, fail, ok } from '@/lib/api-error';
import { requireAdminRequestSession } from '@/lib/admin';
import { setRegistrationDefaultProfile } from '@/lib/employee-onboarding';

export async function PUT(request: Request) {
  try {
    const session = await requireAdminRequestSession(request);
    const parsed = z.object({ profileId: z.string().uuid() }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError({ code: 'VALIDATION_ERROR', message: 'Invalid default model profile.', status: 400 });
    return ok(await setRegistrationDefaultProfile(session.user.id, parsed.data.profileId));
  } catch (error) { return fail(error); }
}
