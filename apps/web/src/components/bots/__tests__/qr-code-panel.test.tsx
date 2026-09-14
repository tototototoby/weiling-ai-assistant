// @vitest-environment jsdom

import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithLocale } from '@/test/render';
import { describe, expect, it, vi } from 'vitest';
import { QrCodePanel } from '../qr-code-panel';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

describe('QrCodePanel', () => {
  it('does not render a preview or link for untrusted qr urls', () => {
    renderWithLocale(
      React.createElement(QrCodePanel, {
        qrCodeId: 'qr_1',
        qrCodeUrl: 'javascript:alert(1)',
      }),
      { locale: 'zh-CN' }
    );

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('暂无二维码')).toBeInTheDocument();
  });

  it('falls back to a page link for liteapp QR landing URLs', () => {
    renderWithLocale(
      React.createElement(QrCodePanel, {
        qrCodeId: null,
        qrCodeUrl:
          'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=00000000000000000000000000000000&bot_type=3',
      }),
      { locale: 'en' }
    );

    const preview = screen.getByRole('img', { name: 'Weixin QR code' });
    const link = screen.getByRole('link', { name: 'Open QR page' });

    expect(preview.getAttribute('src')).toContain(
      '/api/qrcode?value=https%3A%2F%2Fliteapp.weixin.qq.com%2Fq%2F7GiQu1%3Fqrcode%3D00000000000000000000000000000000%26bot_type%3D3'
    );
    expect(link.getAttribute('href')).toBe(
      'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=00000000000000000000000000000000&bot_type=3'
    );
  });
});
