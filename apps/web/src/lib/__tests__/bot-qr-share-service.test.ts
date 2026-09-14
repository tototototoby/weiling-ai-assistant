import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findActiveByTokenHashMock = vi.fn();
const findBotByIdMock = vi.fn();
const requestQrReissueMock = vi.fn();
const upsertActiveByBotInstanceIdMock = vi.fn();

vi.mock('../env', () => ({
  getEnv: () => ({ APP_BASE_URL: 'https://weiling.example' }),
}));

vi.mock('../repositories', () => ({
  getRepositories: () => ({
    botInstances: {
      findById: findBotByIdMock,
      requestQrReissue: requestQrReissueMock,
    },
    botQrShares: {
      findActiveByTokenHash: findActiveByTokenHashMock,
      upsertActiveByBotInstanceId: upsertActiveByBotInstanceIdMock,
    },
  }),
}));

describe('public QR share expiry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-23T02:09:59.999Z'));
    findActiveByTokenHashMock.mockResolvedValue({
      botInstanceId: 'bot_1',
      id: 'share_1',
    });
    findBotByIdMock.mockResolvedValue({
      id: 'bot_1',
      lastQrCodeUrl: 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=abc&bot_type=3',
      qrCodeIssuedAt: new Date('2026-07-23T02:00:00.000Z'),
      qrReissueRequestedAt: null,
      status: 'waiting_for_qr',
      updatedAt: new Date('2026-07-23T02:00:00.000Z'),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serves a trusted QR URL until the exact ten-minute boundary', async () => {
    const { getPublicBotQrShare } = await import('../bot-qr-share-service');
    const result = await getPublicBotQrShare('public_token');

    expect(findActiveByTokenHashMock).toHaveBeenCalledWith(
      createHash('sha256').update('public_token').digest('hex'),
    );
    expect(result).toMatchObject({
      canReissue: false,
      qrCodeExpired: false,
      qrCodeExpiresAt: '2026-07-23T02:10:00.000Z',
      qrCodeIssuedAt: '2026-07-23T02:00:00.000Z',
      qrCodeUrl: 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=abc&bot_type=3',
      reissueRequestedAt: null,
    });
  });

  it('hides the expired URL and allows one reissue intent', async () => {
    vi.setSystemTime(new Date('2026-07-23T02:10:00.000Z'));
    requestQrReissueMock.mockResolvedValue({ id: 'bot_1' });

    const { getPublicBotQrShare, requestPublicBotQrReissue } = await import('../bot-qr-share-service');
    const result = await getPublicBotQrShare('public_token');

    expect(result).toMatchObject({
      canReissue: true,
      qrCodeExpired: true,
      qrCodeUrl: null,
    });

    await expect(requestPublicBotQrReissue('public_token')).resolves.toEqual({ requested: true });
    expect(requestQrReissueMock).toHaveBeenCalledWith('bot_1', new Date('2026-07-23T02:10:00.000Z'));
  });

  it('rejects public reissue while the current QR code is still valid', async () => {
    const { requestPublicBotQrReissue } = await import('../bot-qr-share-service');

    await expect(requestPublicBotQrReissue('public_token')).rejects.toMatchObject({
      code: 'QR_CODE_NOT_EXPIRED',
      status: 409,
    });
    expect(requestQrReissueMock).not.toHaveBeenCalled();
  });

  it('does not expose whether a missing token ever existed', async () => {
    findActiveByTokenHashMock.mockResolvedValue(null);

    const { getPublicBotQrShare } = await import('../bot-qr-share-service');

    await expect(getPublicBotQrShare('unknown_token')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'QR share not found.',
      status: 404,
    });
    expect(findBotByIdMock).not.toHaveBeenCalled();
  });

  it('returns the repository token when concurrent share enables converge on an existing share', async () => {
    upsertActiveByBotInstanceIdMock.mockResolvedValue({
      id: 'share_1',
      revokedAt: null,
      token: 'existing-token',
    });

    const { enableBotQrShare } = await import('../bot-qr-share-service');
    const result = await enableBotQrShare('bot_1');

    expect(result).toMatchObject({
      publicUrl: 'https://weiling.example/share/qr/existing-token',
      shareId: 'share_1',
    });
  });
});
