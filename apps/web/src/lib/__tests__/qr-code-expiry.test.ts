import { describe, expect, it } from 'vitest';
import { getQrCodeExpiresAt, isQrCodeExpired, QR_CODE_TTL_MS } from '../qr-code-expiry';

describe('QR code expiry', () => {
  it('uses a ten-minute TTL from the issue timestamp', () => {
    const issuedAt = new Date('2026-07-23T02:00:00.000Z');

    expect(QR_CODE_TTL_MS).toBe(10 * 60 * 1000);
    expect(getQrCodeExpiresAt(issuedAt)?.toISOString()).toBe('2026-07-23T02:10:00.000Z');
    expect(isQrCodeExpired(issuedAt, Date.parse('2026-07-23T02:09:59.999Z'))).toBe(false);
    expect(isQrCodeExpired(issuedAt, Date.parse('2026-07-23T02:10:00.000Z'))).toBe(true);
  });

  it('accepts ISO timestamps and treats missing or invalid timestamps as unknown', () => {
    expect(getQrCodeExpiresAt('2026-07-23T02:00:00.000Z')?.toISOString()).toBe('2026-07-23T02:10:00.000Z');
    expect(getQrCodeExpiresAt(null)).toBeNull();
    expect(getQrCodeExpiresAt(undefined)).toBeNull();
    expect(getQrCodeExpiresAt('not-a-date')).toBeNull();
    expect(isQrCodeExpired(null, Date.parse('2026-07-23T03:00:00.000Z'))).toBe(false);
    expect(isQrCodeExpired('not-a-date', Date.parse('2026-07-23T03:00:00.000Z'))).toBe(false);
  });
});
