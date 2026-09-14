// @vitest-environment jsdom

import * as React from 'react';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { renderWithLocale } from '@/test/render';
import { ADMIN_MESSAGE_COPY_DEFAULTS } from '@/lib/admin-message-copy';
import type { AdminMessagesPayload } from '@/lib/admin-messages';
import { AdminMessagesConsole } from '../admin-messages-console';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('polls pending deliveries and stops showing pending after the supervisor reports a terminal result', async () => {
  vi.useFakeTimers();
  const terminal = createPayload('sent');
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({ data: terminal, error: null }),
    ok: true,
  });
  vi.stubGlobal('fetch', fetchMock);

  renderWithLocale(<AdminMessagesConsole initialData={createPayload('pending')} />, { locale: 'zh-CN' });
  expect(screen.getByText('pending')).toBeInTheDocument();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_500);
  });

  expect(fetchMock).toHaveBeenCalledWith('/api/admin/messages');
  expect(screen.getByText('sent')).toBeInTheDocument();
  expect(screen.queryByText('pending')).not.toBeInTheDocument();
});

it('persists the deferred delivery switch through the administrator API', async () => {
  const updated = createPayload('sent', false);
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({ data: updated, error: null }),
    ok: true,
  });
  vi.stubGlobal('fetch', fetchMock);

  renderWithLocale(<AdminMessagesConsole initialData={createPayload('sent', true)} />, { locale: 'en' });
  fireEvent.click(screen.getByRole('switch'));

  await vi.waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/messages', expect.objectContaining({
      body: JSON.stringify({ deferFailedUntilUserActive: false, ...ADMIN_MESSAGE_COPY_DEFAULTS }),
      method: 'PATCH',
    }));
    expect(screen.getByRole('switch')).not.toBeChecked();
  });
});

it('saves edited global copy separately from the delivery policy', async () => {
  const updated = createPayload('sent');
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({ data: updated, error: null }),
    ok: true,
  });
  vi.stubGlobal('fetch', fetchMock);

  renderWithLocale(<AdminMessagesConsole initialData={createPayload('sent')} />, { locale: 'en' });
  fireEvent.change(screen.getByLabelText('Assistant name'), { target: { value: 'Gao Zhi Ling' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Copy' }));

  await vi.waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/messages', expect.objectContaining({
      body: JSON.stringify({
        deferFailedUntilUserActive: true,
        ...ADMIN_MESSAGE_COPY_DEFAULTS,
        assistantName: 'Gao Zhi Ling',
      }),
      method: 'PATCH',
    }));
  });
});

it('restores copy defaults in the client without saving immediately', () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  renderWithLocale(<AdminMessagesConsole initialData={createPayload('sent')} />, { locale: 'en' });
  fireEvent.change(screen.getByLabelText('Assistant name'), { target: { value: 'Custom Assistant' } });
  fireEvent.click(screen.getByRole('button', { name: 'Restore Defaults' }));

  expect(screen.getByLabelText('Assistant name')).toHaveValue(ADMIN_MESSAGE_COPY_DEFAULTS.assistantName);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('blocks unsupported control characters before sending the configuration', () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  renderWithLocale(<AdminMessagesConsole initialData={createPayload('sent')} />, { locale: 'en' });
  fireEvent.change(screen.getByLabelText('Morning briefing intro'), {
    target: { value: 'Morning\nbriefing' },
  });

  expect(screen.getByText('Line breaks and control characters are not supported')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save Copy' })).toBeDisabled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('shows deferred deliveries as waiting for the user without continuously polling them', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  renderWithLocale(<AdminMessagesConsole initialData={createPayload('waiting_for_user')} />, { locale: 'en' });

  expect(screen.getByText('Waiting for user')).toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('polls a waiting delivery after deferral is disabled until the supervisor finalizes it', async () => {
  vi.useFakeTimers();
  const terminal = createPayload('failed', false);
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({ data: terminal, error: null }),
    ok: true,
  });
  vi.stubGlobal('fetch', fetchMock);

  renderWithLocale(
    <AdminMessagesConsole initialData={createPayload('waiting_for_user', false)} />,
    { locale: 'en' },
  );

  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_500);
  });

  expect(fetchMock).toHaveBeenCalledWith('/api/admin/messages');
  expect(screen.getByText('failed')).toBeInTheDocument();
});

function createPayload(
  status: AdminMessagesPayload['deliveries'][number]['status'],
  deferFailedUntilUserActive = true,
): AdminMessagesPayload {
  return {
    config: {
      ...ADMIN_MESSAGE_COPY_DEFAULTS,
      deferFailedUntilUserActive,
      observedRevision: 1,
      revision: 1,
      updatedAt: '2026-07-23T02:00:02.000Z',
      updatedByEmail: 'admin@example.com',
    },
    deliveries: [{
      attemptCount: status === 'pending' ? 0 : 1,
      batchId: 'batch_1',
      botId: 'bot_1',
      botName: '测试 Bot',
      createdAt: '2026-07-23T02:00:00.000Z',
      lastError: null,
      message: '管理员通知',
      ownerEmail: 'employee@example.com',
      sentAt: status === 'sent' ? '2026-07-23T02:00:02.000Z' : null,
      status,
      updatedAt: '2026-07-23T02:00:02.000Z',
    }],
    emailConfig: {
      enabled: false,
      observedRevision: null,
      passwordConfigured: false,
      revision: 1,
      senderEmail: null,
      senderName: '微Link · 微灵 AI 助手',
      smtpHost: 'smtp.exmail.qq.com',
      smtpPort: 465,
      smtpSecurity: 'ssl',
      updatedAt: '2026-07-23T02:00:02.000Z',
    },
    emailDeliveries: [],
    targets: [{
      botId: 'bot_1',
      botName: '测试 Bot',
      ownerEmail: 'employee@example.com',
      ownerUserId: 'user_1',
      runtimeStatus: 'running',
    }],
  };
}
