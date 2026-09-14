// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { renderWithLocale } from '@/test/render';
import type { AdminMorningBriefingPayload } from '@/lib/morning-briefing-admin';
import { AdminMorningBriefingsConsole } from '../admin-morning-briefings-console';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('shows summaries, employee protection, revisions, and central scheduling status', () => {
  renderWithLocale(<AdminMorningBriefingsConsole initialData={createPayload()} />, { locale: 'en' });

  expect(screen.getByText('Morning Bot')).toBeInTheDocument();
  expect(screen.getAllByText('Employee Opted Out').length).toBeGreaterThan(0);
  expect(screen.getByText('2 / 1')).toBeInTheDocument();
  expect(screen.getByText(/Supervisor centrally schedules and delivers/)).toBeInTheDocument();
  expect(screen.getAllByText('Awaiting Supervisor Schedule').length).toBeGreaterThan(0);
  expect(document.querySelector('[data-morning-briefing-row]')).not.toBeNull();
});

it('bulk applies defaults to selected bots', async () => {
  const responseData = createPayload();
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({ data: responseData, error: null }),
    ok: true,
  });
  vi.stubGlobal('fetch', fetchMock);
  renderWithLocale(<AdminMorningBriefingsConsole initialData={createPayload()} />, { locale: 'en' });

  await userEvent.click(screen.getByRole('checkbox', { name: 'Select Morning Bot' }));
  await userEvent.click(screen.getByRole('button', { name: /Apply Xiamen 08:30 Defaults/ }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/morning-briefings', expect.objectContaining({
    body: JSON.stringify({
      botInstanceIds: ['bot_1'],
      patch: { deliveryTime: '08:30', location: '北京', timezone: 'Asia/Shanghai' },
      scope: 'selected',
    }),
    method: 'PATCH',
  })));
});

it('edits one bot without exposing workspace paths', async () => {
  const updated = { ...createPayload().items[0], deliveryTime: '09:15', location: '泉州' };
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({ data: updated, error: null }),
    ok: true,
  });
  vi.stubGlobal('fetch', fetchMock);
  renderWithLocale(<AdminMorningBriefingsConsole initialData={createPayload()} />, { locale: 'en' });

  await userEvent.click(screen.getByRole('button', { name: 'Edit Policy' }));
  await userEvent.clear(screen.getByLabelText('Location'));
  await userEvent.type(screen.getByLabelText('Location'), '泉州');
  await userEvent.clear(screen.getByLabelText('Delivery Time'));
  await userEvent.type(screen.getByLabelText('Delivery Time'), '09:15');
  await userEvent.click(screen.getByRole('button', { name: 'Save Policy' }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/morning-briefings/bot_1', expect.objectContaining({
    body: JSON.stringify({
      deliveryTime: '09:15',
      forceEnabled: false,
      location: '泉州',
      timezone: 'Asia/Shanghai',
    }),
    method: 'PATCH',
  })));
  expect(screen.queryByLabelText('Workspace Base Path')).not.toBeInTheDocument();
});

function createPayload(): AdminMorningBriefingPayload {
  return {
    items: [{
      adminEnabled: true,
      appliedRevision: 1,
      botId: 'bot_1',
      botName: 'Morning Bot',
      centralLastDeliveredAt: null,
      centralLastDeliveryDate: null,
      centralLastError: null,
      centralScheduledFor: null,
      deliveryTime: '08:30',
      desiredRevision: 2,
      forceEnabled: false,
      lastSyncError: null,
      lastSyncedAt: '2026-07-20T01:00:00.000Z',
      location: '北京',
      observedUserOptOut: true,
      ownerEmail: 'employee@example.com',
      runtimeNeedsCleanup: false,
      runtimeNeedsSchedule: true,
      runtimeObservedAt: '2026-07-20T01:00:00.000Z',
      runtimeScheduledFor: null,
      runtimeStatus: 'running',
      scheduleStatus: 'setup-required',
      syncStatus: 'pending',
      timezone: 'Asia/Shanghai',
      updatedAt: '2026-07-20T01:00:00.000Z',
    }],
    summary: { enabled: 0, needsAttention: 1, optedOut: 1, pending: 1, total: 1 },
  };
}
