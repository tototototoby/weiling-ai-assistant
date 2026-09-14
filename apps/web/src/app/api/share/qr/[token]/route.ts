import { getPublicBotQrShare, requestPublicBotQrReissue } from '@/lib/bot-qr-share-service';
import { fail, ok } from '@/lib/api-error';

interface RouteContext {
  params: Promise<{ token: string }> | { token: string };
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { token } = await context.params;
    const response = ok(await getPublicBotQrShare(token));
    response.headers.set('cache-control', 'no-store');
    return response;
  } catch (error) {
    const response = fail(error);
    response.headers.set('cache-control', 'no-store');
    return response;
  }
}

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { token } = await context.params;
    const response = ok(await requestPublicBotQrReissue(token));
    response.headers.set('cache-control', 'no-store');
    return response;
  } catch (error) {
    const response = fail(error);
    response.headers.set('cache-control', 'no-store');
    return response;
  }
}
