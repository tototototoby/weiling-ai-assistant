import { z } from 'zod';
import { fail, ok } from '@/lib/api-error';
import { ApiError } from '@/lib/api-error';
import { getWorkspaceRoot, resolveInstancesRoot } from '@/lib/env';
import { requireOwnedBot, requireRequestSession } from '@/lib/session';
import {
  resolveManagedSkillsBundleRoot,
  syncManagedSkills,
} from '@weiling-ai/shared/managed-skills';

const SyncSkillsRequestSchema = z.object({
  operation: z.enum([
    'remove-all-managed',
    'remove-selected-managed',
    'sync-all-managed',
    'sync-selected-managed',
  ]).optional(),
  skillNames: z.array(z.string().min(1)).optional(),
});

interface RouteContext {
  params: Promise<{ id: string }> | { id: string };
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const session = await requireRequestSession(request);
    const { id } = await context.params;

    await requireOwnedBot(id, session.user.id);

    const body = await parseRequestBody(request);

    if (body.operation && body.operation !== 'sync-all-managed') {
      throw new ApiError({
        code: 'UNSUPPORTED_OPERATION',
        message: 'Only sync-all-managed is currently supported.',
        status: 400,
      });
    }

    const result = await syncManagedSkills({
      botInstanceId: id,
      bundleRoot: resolveManagedSkillsBundleRoot(getWorkspaceRoot()),
      instancesRoot: resolveInstancesRoot(),
      operation: {
        type: 'sync-all-managed',
      },
    });

    return ok({
      result,
    }, result.status === 'busy' ? 409 : 200);
  } catch (error) {
    return fail(error);
  }
}

async function parseRequestBody(request: Request) {
  const contentType = request.headers.get('content-type') ?? '';

  if (!contentType.includes('application/json')) {
    return {};
  }

  const rawBody = await request.text();

  if (rawBody.trim().length === 0) {
    return {};
  }

  return SyncSkillsRequestSchema.parse(JSON.parse(rawBody));
}
