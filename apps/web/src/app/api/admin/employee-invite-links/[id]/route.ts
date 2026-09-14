import { z } from 'zod';
import { ApiError, fail, ok } from '@/lib/api-error';
import { requireAdminRequestSession } from '@/lib/admin';
import { setEmployeeInviteLinkEnabled } from '@/lib/employee-onboarding';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminRequestSession(request);
    const parsed = z.object({ enabled: z.boolean() }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError({ code: 'VALIDATION_ERROR', message: 'Invalid invite link state.', status: 400 });
    return ok(await setEmployeeInviteLinkEnabled((await context.params).id, parsed.data.enabled));
  } catch (error) { return fail(error); }
}
