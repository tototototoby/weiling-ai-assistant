import { createHash, randomUUID } from 'node:crypto';
import { normalizeTrustedQrCodeUrl } from '@weiling-ai/shared';
import { ApiError } from './api-error';
import { getEnv } from './env';
import { getQrCodeExpiresAt, isQrCodeExpired } from './qr-code-expiry';
import { getRepositories } from './repositories';

export interface BotQrShareOwnerItem {
  publicUrl: string;
  revokedAt: string | null;
  shareId: string;
}

export interface PublicBotQrShareItem {
  canReissue: boolean;
  qrCodeExpired: boolean;
  qrCodeExpiresAt: string | null;
  qrCodeIssuedAt: string | null;
  qrCodeUrl: string | null;
  reissueRequestedAt: string | null;
  shareId: string;
  status: string;
  updatedAt: string;
}

export async function getBotQrShareForOwner(botInstanceId: string): Promise<BotQrShareOwnerItem | null> {
  const share = await getRepositories().botQrShares.findActiveByBotInstanceId(botInstanceId);

  if (!share) {
    return null;
  }

  return {
    publicUrl: buildPublicQrShareUrl(share.token),
    revokedAt: share.revokedAt?.toISOString() ?? null,
    shareId: share.id,
  };
}

export async function enableBotQrShare(botInstanceId: string): Promise<BotQrShareOwnerItem> {
  const token = randomUUID();
  const share = await getRepositories().botQrShares.upsertActiveByBotInstanceId({
    botInstanceId,
    token,
    tokenHash: hashShareToken(token),
  });

  if (!share) {
    throw new ApiError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to create QR share link.',
      status: 500,
    });
  }

  return {
    publicUrl: buildPublicQrShareUrl(share.token),
    revokedAt: share.revokedAt?.toISOString() ?? null,
    shareId: share.id,
  };
}

export async function disableBotQrShare(botInstanceId: string): Promise<BotQrShareOwnerItem | null> {
  const share = await getRepositories().botQrShares.revokeByBotInstanceId(botInstanceId);

  if (!share) {
    return null;
  }

  return {
    publicUrl: buildPublicQrShareUrl(share.token),
    revokedAt: share.revokedAt?.toISOString() ?? null,
    shareId: share.id,
  };
}

export async function getPublicBotQrShare(token: string): Promise<PublicBotQrShareItem> {
  const share = await getRepositories().botQrShares.findActiveByTokenHash(hashShareToken(token));

  if (!share) {
    throw new ApiError({
      code: 'NOT_FOUND',
      message: 'QR share not found.',
      status: 404,
    });
  }

  const bot = await getRepositories().botInstances.findById(share.botInstanceId);

  if (!bot) {
    throw new ApiError({
      code: 'NOT_FOUND',
      message: 'QR share not found.',
      status: 404,
    });
  }

  const qrCodeIssuedAt = bot.status === 'waiting_for_qr' && bot.lastQrCodeUrl
    ? bot.qrCodeIssuedAt ?? bot.updatedAt
    : null;
  const qrCodeExpiresAt = getQrCodeExpiresAt(qrCodeIssuedAt);
  const qrCodeExpired = isQrCodeExpired(qrCodeIssuedAt);

  return {
    canReissue: bot.status === 'waiting_for_qr' && qrCodeExpired && !bot.qrReissueRequestedAt,
    qrCodeExpired,
    qrCodeExpiresAt: qrCodeExpiresAt?.toISOString() ?? null,
    qrCodeIssuedAt: qrCodeIssuedAt?.toISOString() ?? null,
    qrCodeUrl: bot.status === 'waiting_for_qr' && !qrCodeExpired ? normalizeTrustedQrCodeUrl(bot.lastQrCodeUrl) : null,
    reissueRequestedAt: bot.qrReissueRequestedAt?.toISOString() ?? null,
    shareId: share.id,
    status: bot.status,
    updatedAt: bot.updatedAt.toISOString(),
  };
}

export async function requestPublicBotQrReissue(token: string) {
  const repositories = getRepositories();
  const share = await repositories.botQrShares.findActiveByTokenHash(hashShareToken(token));

  if (!share) {
    throw new ApiError({ code: 'NOT_FOUND', message: 'QR share not found.', status: 404 });
  }

  const bot = await repositories.botInstances.findById(share.botInstanceId);
  if (!bot) {
    throw new ApiError({ code: 'NOT_FOUND', message: 'QR share not found.', status: 404 });
  }

  if (bot.qrReissueRequestedAt) {
    return { requested: true };
  }

  const issuedAt = bot.qrCodeIssuedAt ?? bot.updatedAt;
  if (bot.status !== 'waiting_for_qr' || !bot.lastQrCodeUrl || !isQrCodeExpired(issuedAt)) {
    throw new ApiError({
      code: 'QR_CODE_NOT_EXPIRED',
      message: 'The current QR code is still valid.',
      status: 409,
    });
  }

  const requested = await repositories.botInstances.requestQrReissue(bot.id, new Date());
  if (!requested) {
    throw new ApiError({ code: 'NOT_FOUND', message: 'QR share not found.', status: 404 });
  }

  return { requested: true };
}

function hashShareToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function buildPublicQrShareUrl(token: string) {
  return new URL(`/share/qr/${token}`, getEnv().APP_BASE_URL).toString();
}
