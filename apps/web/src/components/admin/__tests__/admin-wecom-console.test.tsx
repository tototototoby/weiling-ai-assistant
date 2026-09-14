// @vitest-environment jsdom

import * as React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { renderWithLocale } from '@/test/render';
import { AdminWecomConsole } from '../admin-wecom-console';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('keeps the Secret redacted and preserves it when saving other configuration', async () => {
  const updated = createPayload({ botId: 'wecom_bot_2', revision: 3 });
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({ data: updated, error: null }),
    ok: true,
  });
  vi.stubGlobal('fetch', fetchMock);

  renderWithLocale(<AdminWecomConsole initialData={createPayload()} />, { locale: 'en' });

  expect(screen.getByLabelText('Secret')).toHaveValue('');
  expect(screen.getByText('Configured')).toBeInTheDocument();
  expect(document.body).not.toHaveTextContent('stored-secret');

  const botId = screen.getByLabelText('Bot ID');
  await userEvent.clear(botId);
  await userEvent.type(botId, 'wecom_bot_2');
  await userEvent.click(screen.getByRole('button', { name: 'Save configuration' }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(fetchMock).toHaveBeenCalledWith('/api/admin/wecom', expect.objectContaining({ method: 'PATCH' }));
  expect(JSON.parse(String(init.body))).toEqual({
    botId: 'wecom_bot_2',
    enabled: true,
    wsUrl: 'wss://openws.work.weixin.qq.com',
  });
});

it('lists Bot channels and directs binding management to the Bot detail page', () => {
  renderWithLocale(<AdminWecomConsole initialData={createPayload({ wecomUserId: '' })} />, { locale: 'en' });

  expect(screen.queryByText('The employee roster is empty. Add employees in invitation management first.'))
    .not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Manage in Bot' }))
    .toHaveAttribute('href', '/admin/bots/bot_1');
});

it('requests a durable reconnect without supplying credentials', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({ data: createPayload({ revision: 3 }), error: null }),
    ok: true,
  });
  vi.stubGlobal('fetch', fetchMock);

  renderWithLocale(<AdminWecomConsole initialData={createPayload()} />, { locale: 'en' });

  await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  expect(fetchMock).toHaveBeenCalledWith('/api/admin/wecom/reconnect', { method: 'POST' });
});

it('renders only a masked onboarding identity and resets it with the opaque token', async () => {
  const resetToken = 'a'.repeat(64);
  const initialData = createPayload({
    onboardingSessions: [{
      attemptCount: 5,
      cooldownUntil: '2026-07-28T08:10:00.000Z',
      createdAt: '2026-07-28T08:00:00.000Z',
      expiresAt: '2026-07-28T08:15:00.000Z',
      maskedWecomUserId: 'zha***ng',
      resetToken,
      state: 'cooldown',
      updatedAt: '2026-07-28T08:05:00.000Z',
    }],
  });
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({ data: createPayload(), error: null }),
    ok: true,
  });
  vi.stubGlobal('fetch', fetchMock);

  renderWithLocale(<AdminWecomConsole initialData={initialData} />, { locale: 'en' });

  expect(screen.getByText('zha***ng')).toBeInTheDocument();
  expect(document.body).not.toHaveTextContent('zhangting');
  await userEvent.click(screen.getByRole('button', { name: 'Reset identity' }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  expect(fetchMock).toHaveBeenCalledWith('/api/admin/wecom/onboarding/reset', expect.objectContaining({
    body: JSON.stringify({ resetToken }),
    method: 'POST',
  }));
});

it('renders the onboarding controls in Chinese without exposing the raw identity', () => {
  const resetToken = 'b'.repeat(64);
  renderWithLocale(<AdminWecomConsole initialData={createPayload({
    onboardingSessions: [{
      attemptCount: 1,
      cooldownUntil: null,
      createdAt: '2026-07-28T08:00:00.000Z',
      expiresAt: '2026-07-28T08:15:00.000Z',
      maskedWecomUserId: 'li***ng',
      resetToken,
      state: 'pending',
      updatedAt: '2026-07-28T08:05:00.000Z',
    }],
  })} />, { locale: 'zh-CN' });

  expect(screen.getByText('待识别员工')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '重置识别' })).toBeInTheDocument();
  expect(screen.getByText('li***ng')).toBeInTheDocument();
  expect(document.body).not.toHaveTextContent('lixiaoming');
});

function createPayload(input: {
  botId?: string;
  onboardingSessions?: Array<{
    attemptCount: number;
    cooldownUntil: string | null;
    createdAt: string;
    expiresAt: string | null;
    maskedWecomUserId: string;
    resetToken: string;
    state: 'cooldown' | 'pending';
    updatedAt: string;
  }>;
  revision?: number;
  wecomUserId?: string;
} = {}) {
  const wecomUserId = input.wecomUserId ?? '';
  return {
    config: {
      botId: input.botId ?? 'wecom_bot_1',
      connectionStatus: 'connected',
      enabled: true,
      lastConnectedAt: '2026-07-27T01:00:00.000Z',
      lastDisconnectedAt: null,
      lastError: null,
      observedRevision: 2,
      revision: input.revision ?? 2,
      secretConfigured: true,
      updatedAt: '2026-07-27T01:00:00.000Z',
      wsUrl: 'wss://openws.work.weixin.qq.com',
    },
    bots: [{
      botId: 'bot_1',
      botName: 'Bot One',
      bound: Boolean(wecomUserId),
      employeeId: null,
      employeeName: null,
      enabled: true,
      lastError: null,
      lastInboundAt: null,
      lastOutboundAt: null,
      ownerEmail: 'admin@example.com',
      ownerUserId: 'user_1',
      preferredForProactive: true,
      updatedAt: null,
      wecomUserId,
    }],
    onboardingSessions: input.onboardingSessions ?? [],
    summary: {
      boundCount: wecomUserId ? 1 : 0,
      botCount: 1,
      enabledCount: wecomUserId ? 1 : 0,
      errorCount: 0,
      cooldownOnboardingCount: input.onboardingSessions?.filter((session) => session.state === 'cooldown').length ?? 0,
      pendingOnboardingCount: input.onboardingSessions?.filter((session) => session.state === 'pending').length ?? 0,
    },
  };
}
