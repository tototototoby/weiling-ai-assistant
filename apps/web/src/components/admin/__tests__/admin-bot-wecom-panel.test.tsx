// @vitest-environment jsdom

import * as React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { renderWithLocale } from '@/test/render';
import { AdminBotWecomPanel } from '../admin-bot-wecom-panel';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('binds WeCom directly from the Bot detail without employee metadata', async () => {
  const updated = createBinding({ bound: true, wecomUserId: 'zhangting' });
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({ data: updated, error: null }),
    ok: true,
  });
  vi.stubGlobal('fetch', fetchMock);

  renderWithLocale(<AdminBotWecomPanel initialData={createBinding()} />, { locale: 'en' });
  await userEvent.type(screen.getByLabelText('WeCom User ID'), 'zhangting');
  await userEvent.click(screen.getByRole('button', { name: 'Save binding' }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/admin/bots/bot_1/wecom',
    expect.objectContaining({ method: 'PATCH' }),
  );
  expect(JSON.parse(String(init.body))).toEqual({
    enabled: false,
    preferredForProactive: true,
    wecomUserId: 'zhangting',
  });
  expect(screen.getByText('Channel disabled')).toBeInTheDocument();
});

it('unbinds the Bot channel from the same panel', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({ data: createBinding(), error: null }),
    ok: true,
  });
  vi.stubGlobal('fetch', fetchMock);

  renderWithLocale(
    <AdminBotWecomPanel initialData={createBinding({ bound: true, enabled: true, wecomUserId: 'zhangting' })} />,
    { locale: 'en' },
  );
  await userEvent.click(screen.getByRole('button', { name: 'Unbind' }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
    '/api/admin/bots/bot_1/wecom',
    { method: 'DELETE' },
  ));
  expect(screen.getByText('Unbound')).toBeInTheDocument();
});

function createBinding(input: Partial<{
  bound: boolean;
  enabled: boolean;
  wecomUserId: string;
}> = {}) {
  return {
    botId: 'bot_1',
    botName: 'Bot One',
    bound: input.bound ?? false,
    employeeId: null,
    employeeName: null,
    enabled: input.enabled ?? false,
    lastError: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    ownerEmail: 'admin@example.com',
    ownerUserId: 'user_1',
    preferredForProactive: true,
    updatedAt: null,
    wecomUserId: input.wecomUserId ?? '',
  };
}
