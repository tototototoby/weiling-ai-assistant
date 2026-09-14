// @vitest-environment jsdom

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { renderWithLocale } from '@/test/render';
import type { AdminBotsPayload } from '@/lib/admin-bots';
import { AdminBotsConsole } from '../admin-bots-console';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

it('shows cross-user inventory and keeps detail links inside the admin shell', async () => {
  renderWithLocale(<AdminBotsConsole initialData={createPayload()} />, { locale: 'en' });

  expect(screen.getByText('employee@example.com')).toBeInTheDocument();
  expect(screen.getByText('Qwen3.7 Plus')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Manage' })).toHaveAttribute('href', '/admin/bots/bot_1');

  await userEvent.type(screen.getByLabelText('Search bots'), 'missing');
  expect(screen.getByText('No bots match the current filters.')).toBeInTheDocument();
});

function createPayload(): AdminBotsPayload {
  return {
    items: [{
      createdAt: '2026-07-20T00:00:00.000Z',
      desiredState: 'running',
      id: 'bot_1',
      model: 'Qwen3.7 Plus',
      morningBriefing: {
        adminEnabled: true,
        appliedRevision: 1,
        centralLastDeliveredAt: null,
        centralLastDeliveryDate: null,
        centralLastError: null,
        centralScheduledFor: '2027-07-27T00:30:00.000Z',
        deliveryTime: '08:30',
        desiredRevision: 2,
        forceEnabled: false,
        lastSyncError: null,
        lastSyncedAt: null,
        location: '北京',
        observedUserOptOut: false,
        runtimeNeedsCleanup: false,
        runtimeNeedsSchedule: false,
        runtimeObservedAt: '2026-07-20T01:00:00.000Z',
        runtimeScheduledFor: '2027-07-27T00:30:00.000Z',
        scheduleStatus: 'scheduled',
        syncStatus: 'pending',
        timezone: 'Asia/Shanghai',
      },
      name: 'Morning Bot',
      ownerEmail: 'employee@example.com',
      ownerUserId: 'user_1',
      provider: 'opencode',
      status: 'running',
      updatedAt: '2026-07-20T01:00:00.000Z',
    }],
    summary: { briefingEnabled: 1, pendingReconciliation: 1, running: 1, total: 1, unhealthy: 0 },
  };
}
