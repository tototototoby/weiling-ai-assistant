import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPublicBotQrShareMock = vi.fn();
const requestPublicBotQrReissueMock = vi.fn();

vi.mock('@/lib/bot-qr-share-service', () => ({
  getPublicBotQrShare: getPublicBotQrShareMock,
  requestPublicBotQrReissue: requestPublicBotQrReissueMock,
}));

describe('/api/share/qr/[token] route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns the current public qr payload for a valid share token', async () => {
    getPublicBotQrShareMock.mockResolvedValue({
      canReissue: false,
      qrCodeExpired: false,
      qrCodeExpiresAt: '2026-05-10T10:10:00.000Z',
      qrCodeIssuedAt: '2026-05-10T10:00:00.000Z',
      qrCodeUrl: 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=abc&bot_type=3',
      reissueRequestedAt: null,
      shareId: 'share_1',
      status: 'waiting_for_qr',
      updatedAt: '2026-05-10T10:00:00.000Z',
    });

    const { GET } = await import('../route');
    const response = await GET(new Request('http://localhost/api/share/qr/token_1'), {
      params: Promise.resolve({ token: 'token_1' }),
    });

    expect(getPublicBotQrShareMock).toHaveBeenCalledWith('token_1');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      data: {
        canReissue: false,
        qrCodeExpired: false,
        qrCodeExpiresAt: '2026-05-10T10:10:00.000Z',
        qrCodeIssuedAt: '2026-05-10T10:00:00.000Z',
        qrCodeUrl: 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=abc&bot_type=3',
        reissueRequestedAt: null,
        shareId: 'share_1',
        status: 'waiting_for_qr',
        updatedAt: '2026-05-10T10:00:00.000Z',
      },
      error: null,
    });
  });

  it('requests a fresh QR code through the public route and disables caching', async () => {
    requestPublicBotQrReissueMock.mockResolvedValue({ requested: true });

    const { POST } = await import('../route');
    const response = await POST(new Request('http://localhost/api/share/qr/token_1'), {
      params: Promise.resolve({ token: 'token_1' }),
    });

    expect(requestPublicBotQrReissueMock).toHaveBeenCalledWith('token_1');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      data: { requested: true },
      error: null,
    });
  });

  it('returns not found once a share token is revoked or unknown', async () => {
    const { ApiError } = await import('@/lib/api-error');

    getPublicBotQrShareMock.mockRejectedValue(new ApiError({
      code: 'NOT_FOUND',
      message: 'QR share not found.',
      status: 404,
    }));

    const { GET } = await import('../route');
    const response = await GET(new Request('http://localhost/api/share/qr/token_1'), {
      params: Promise.resolve({ token: 'token_1' }),
    });

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: {
        code: 'NOT_FOUND',
        message: 'QR share not found.',
      },
    });
  });

  it('does not cache rejected public QR reissue requests', async () => {
    const { ApiError } = await import('@/lib/api-error');

    requestPublicBotQrReissueMock.mockRejectedValue(new ApiError({
      code: 'QR_CODE_NOT_EXPIRED',
      message: 'The current QR code is still valid.',
      status: 409,
    }));

    const { POST } = await import('../route');
    const response = await POST(new Request('http://localhost/api/share/qr/token_1'), {
      params: Promise.resolve({ token: 'token_1' }),
    });

    expect(response.status).toBe(409);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: {
        code: 'QR_CODE_NOT_EXPIRED',
        message: 'The current QR code is still valid.',
      },
    });
  });
});
