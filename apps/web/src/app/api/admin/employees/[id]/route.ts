import { z } from 'zod';
import { ApiError, fail, ok } from '@/lib/api-error';
import { requireAdminRequestSession } from '@/lib/admin';
import { deleteEmployeeDirectoryEntry, updateEmployeeDirectoryEntry } from '@/lib/employee-onboarding';

const schema = z.object({
  companyEmail: z.string().trim().email().nullable().optional(),
  legalName: z.string().trim().max(100).nullable().optional(),
  nickname: z.string().trim().max(100).nullable().optional(),
  enabled: z.boolean(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminRequestSession(request);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError({ code: 'VALIDATION_ERROR', message: 'Invalid employee record.', status: 400 });
    return ok(await updateEmployeeDirectoryEntry((await context.params).id, parsed.data));
  } catch (error) { return fail(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminRequestSession(request);
    return ok(await deleteEmployeeDirectoryEntry((await context.params).id));
  } catch (error) { return fail(error); }
}
