import { requireAdminRequestSession } from '@/lib/admin';
import { fail, ok } from '@/lib/api-error';
import { disableBotQrShare, enableBotQrShare, getBotQrShareForOwner } from '@/lib/bot-qr-share-service';
import { getBotDetail } from '@/lib/bot-service';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return handleAdminQrShare(request, context, 'get');
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleAdminQrShare(request, context, 'enable');
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return handleAdminQrShare(request, context, 'disable');
}

async function handleAdminQrShare(
  request: Request,
  context: RouteContext,
  action: 'disable' | 'enable' | 'get',
): Promise<Response> {
  try {
    await requireAdminRequestSession(request);
    const { id } = await context.params;
    await getBotDetail(id);

    if (action === 'enable') return ok(await enableBotQrShare(id));
    if (action === 'disable') return ok(await disableBotQrShare(id));
    return ok(await getBotQrShareForOwner(id));
  } catch (error) {
    return fail(error);
  }
}
