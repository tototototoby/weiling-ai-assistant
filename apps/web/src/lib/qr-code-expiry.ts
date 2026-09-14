export const QR_CODE_TTL_MS = 10 * 60 * 1000;

export function getQrCodeExpiresAt(issuedAt: Date | string | null | undefined): Date | null {
  if (!issuedAt) return null;
  const issuedAtDate = issuedAt instanceof Date ? issuedAt : new Date(issuedAt);
  if (Number.isNaN(issuedAtDate.getTime())) return null;
  return new Date(issuedAtDate.getTime() + QR_CODE_TTL_MS);
}

export function isQrCodeExpired(
  issuedAt: Date | string | null | undefined,
  now: number = Date.now(),
): boolean {
  const expiresAt = getQrCodeExpiresAt(issuedAt);
  return expiresAt !== null && expiresAt.getTime() <= now;
}
