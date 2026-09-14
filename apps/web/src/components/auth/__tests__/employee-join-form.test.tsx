// @vitest-environment jsdom

import { expect, it } from 'vitest';
import { toSameOriginQrShareUrl } from '../employee-join-form';

it('keeps the employee QR handoff on the origin used to open the invite', () => {
  expect(toSameOriginQrShareUrl(
    'http://192.0.2.21:3000/share/qr/share_token?refresh=1#qr',
    'https://demo-tunnel.trycloudflare.com',
  )).toBe('https://demo-tunnel.trycloudflare.com/share/qr/share_token?refresh=1#qr');
});

it('rejects an unexpected onboarding redirect path', () => {
  expect(() => toSameOriginQrShareUrl(
    'https://example.com/admin/bots',
    'https://demo-tunnel.trycloudflare.com',
  )).toThrow('unexpected share URL');
});
