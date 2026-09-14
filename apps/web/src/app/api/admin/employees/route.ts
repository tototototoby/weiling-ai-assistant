import { z } from 'zod';
import { ApiError, fail, ok } from '@/lib/api-error';
import { requireAdminRequestSession } from '@/lib/admin';
import { createEmployeeDirectoryEntry, listEmployeeDirectory } from '@/lib/employee-onboarding';

const schema = z.object({
  companyEmail: z.string().trim().email().nullable().optional(),
  legalName: z.string().trim().max(100).nullable().optional(),
  nickname: z.string().trim().max(100).nullable().optional(),
  enabled: z.boolean().optional(),
});

export async function GET(request: Request) {
  try {
    await requireAdminRequestSession(request);
    return ok(await listEmployeeDirectory());
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    await requireAdminRequestSession(request);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError({ code: 'VALIDATION_ERROR', message: 'Invalid employee record.', status: 400 });
    return ok(await createEmployeeDirectoryEntry(parsed.data));
  } catch (error) { return fail(error); }
}
