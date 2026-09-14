// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { renderWithLocale } from '@/test/render';
import { PublicQrShareView } from '../public-qr-share-view';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('offers a public reissue action after the QR code expires', async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return {
        json: async () => ({ data: { requested: true }, error: null }),
        ok: true,
      } as Response;
    }

    return {
      json: async () => ({
        data: {
          canReissue: true,
          qrCodeExpired: true,
          qrCodeExpiresAt: '2026-07-23T02:10:00.000Z',
          qrCodeIssuedAt: '2026-07-23T02:00:00.000Z',
          qrCodeUrl: null,
          reissueRequestedAt: null,
          shareId: 'share_1',
          status: 'waiting_for_qr',
          updatedAt: '2026-07-23T02:10:01.000Z',
        },
        error: null,
      }),
      ok: true,
    } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);

  renderWithLocale(<PublicQrShareView token="share_token" />, { locale: 'en' });

  const reissueButton = await screen.findByRole('button', { name: 'Request new QR code' });
  reissueButton.click();

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith('/api/share/qr/share_token', { method: 'POST' });
  });
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Requesting...' })).toBeInTheDocument();
  });
});

it('presents the custom lobster identity and explicit privacy boundaries', () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    json: async () => ({ data: null, error: null }),
    ok: true,
  }));

  renderWithLocale(<PublicQrShareView token="share_token" />, { locale: 'zh-CN' });

  expect(screen.getByRole('heading', { level: 1, name: '微Link · 微灵 AI 助手' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: '微Link · 微灵 AI 助手头像' })).toHaveAttribute('src', '/brand/weiling-mark.png');
  expect(screen.getByRole('note')).toHaveTextContent('本龙虾只在微信里与你进行 AI 对话');
  expect(screen.getByRole('note')).toHaveTextContent('不会索取或读取你的微信密码、通讯录、朋友圈、历史聊天或支付信息');
  expect(screen.getByRole('note')).toHaveTextContent('不会代替你添加好友、转账、修改资料或进行其他微信账号操作');
});
