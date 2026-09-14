import { z } from 'zod';
import { ApiError, fail, ok } from '@/lib/api-error';
import { registerEmployeeFromInvite } from '@/lib/employee-onboarding';

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const parsed = z.object({ name: z.string().trim().min(1).max(100) })
      .safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError({ code: 'VALIDATION_ERROR', message: 'Enter your name or nickname.', status: 400 });
    const result = await registerEmployeeFromInvite({
      inviteToken: (await context.params).token,
      submittedName: parsed.data.name,
    });
    return ok(result);
  } catch (error) { return fail(error); }
}
