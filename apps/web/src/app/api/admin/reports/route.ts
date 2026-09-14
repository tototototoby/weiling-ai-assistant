import { requireAdminRequestSession } from '@/lib/admin';
import { fail, ok } from '@/lib/api-error';
import { getAdminReports } from '@/lib/reports';

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    const days = Number(new URL(request.url).searchParams.get('days') ?? 7);
    return ok(await getAdminReports(days));
  } catch (error) {
    return fail(error);
  }
}
