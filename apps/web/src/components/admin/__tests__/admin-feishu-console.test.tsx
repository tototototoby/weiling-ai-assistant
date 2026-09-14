// @vitest-environment jsdom

import * as React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { renderWithLocale } from '@/test/render';
import type { AdminFeishuPayload } from '@/lib/feishu-admin';
import { AdminFeishuConsole } from '../admin-feishu-console';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('renders the Bot list with status and owner, and opens the configuration form', async () => {
  renderWithLocale(<AdminFeishuConsole initialData={createPayload()} />, { locale: 'en' });

  expect(screen.getByText('Bot 1')).toBeInTheDocument();
  expect(screen.getAllByText('Connected').length).toBeGreaterThan(0);
  expect(screen.getAllByText('App ID configured').length).toBeGreaterThan(0);
  expect(screen.getByText(/Owner: admin@example\.com/)).toBeInTheDocument();
  expect(screen.getByText(/Owner open_id: ou_a\*\*\*abcd/)).toBeInTheDocument();
  expect(screen.getByText('Bot 2')).toBeInTheDocument();

  await userEvent.click(screen.getAllByRole('button', { name: 'Configure' })[0]);

  expect(screen.getByLabelText('App ID')).toBeInTheDocument();
  expect(screen.getByLabelText('App Secret')).toBeInTheDocument();
});

it('saves credentials with a PATCH and refreshes the list', async () => {
  const updated = createPayload();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({
      json: async () => ({ data: { botId: 'bot_1', enabled: true }, error: null }),
      ok: true,
    })
    .mockResolvedValueOnce({
      json: async () => ({ data: updated, error: null }),
      ok: true,
    });
  vi.stubGlobal('fetch', fetchMock);

  renderWithLocale(<AdminFeishuConsole initialData={createPayload()} />, { locale: 'en' });

  await userEvent.click(screen.getAllByRole('button', { name: 'Configure' })[1]);
  await userEvent.type(screen.getByLabelText('App ID'), 'cli_app-two');
  await userEvent.type(screen.getByLabelText('App Secret'), 'secret-two');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    '/api/admin/bots/bot_2/feishu',
    expect.objectContaining({ method: 'PATCH' }),
  );
  expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/admin/feishu');
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(JSON.parse(String(init.body))).toEqual({
    appId: 'cli_app-two',
    appSecret: 'secret-two',
    enabled: true,
  });
});

it('disables and clears a configured Bot', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({ data: createPayload(), error: null }),
    ok: true,
  });
  vi.stubGlobal('fetch', fetchMock);
  const confirmMock = vi.fn().mockReturnValue(true);
  vi.stubGlobal('confirm', confirmMock);

  renderWithLocale(<AdminFeishuConsole initialData={createPayload()} />, { locale: 'en' });

  await userEvent.click(screen.getAllByRole('button', { name: 'Disable' })[0]);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    '/api/admin/bots/bot_1/feishu',
    expect.objectContaining({ method: 'PATCH' }),
  );

  await userEvent.click(screen.getAllByRole('button', { name: 'Clear' })[0]);
  expect(confirmMock).toHaveBeenCalledOnce();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/admin/bots/bot_1/feishu', {
    method: 'DELETE',
  });
});

function createPayload(): AdminFeishuPayload {
  return {
    bots: [
      {
        appIdConfigured: true,
        botId: 'bot_1',
        botName: 'Bot 1',
        enabled: true,
        eventStatus: 'connected',
        lastConnectedAt: '2026-08-31T10:00:00.000Z',
        lastDisconnectedAt: null,
        lastError: null,
        lastInboundAt: null,
        lastOutboundAt: null,
        ownerEmail: 'admin@example.com',
        ownerOpenId: 'ou_a***abcd',
        ownerUserId: 'admin_1',
        revision: 2,
        secretConfigured: true,
        updatedAt: '2026-08-31T10:00:00.000Z',
      },
      {
        appIdConfigured: false,
        botId: 'bot_2',
        botName: 'Bot 2',
        enabled: false,
        eventStatus: 'not_configured',
        lastConnectedAt: null,
        lastDisconnectedAt: null,
        lastError: null,
        lastInboundAt: null,
        lastOutboundAt: null,
        ownerEmail: 'other@example.com',
        ownerOpenId: null,
        ownerUserId: 'admin_2',
        revision: 1,
        secretConfigured: false,
        updatedAt: null,
      },
    ],
    summary: {
      botCount: 2,
      configuredCount: 1,
      disabledCount: 0,
      enabledCount: 1,
      connectedCount: 1,
      errorCount: 0,
    },
  };
}
