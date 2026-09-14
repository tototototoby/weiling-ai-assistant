// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { renderWithLocale } from '@/test/render';
import type { AdminBotDetailPayload } from '@/lib/admin-bots';
import { AdminBotDetailConsole } from '../admin-bot-detail-console';

const { routerReplaceMock } = vi.hoisted(() => ({ routerReplaceMock: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: routerReplaceMock }) }));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('confirms stop before writing an admin runtime intent', async () => {
  const initialData = createPayload();
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({ data: { ...initialData.bot, desiredState: 'stopped' }, error: null }),
    ok: true,
  });
  vi.stubGlobal('fetch', fetchMock);
  renderWithLocale(<AdminBotDetailConsole initialData={initialData} />, { locale: 'en' });

  await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
  expect(screen.getByText('Confirm Runtime Action')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/bots/bot_1/command', {
    body: JSON.stringify({ action: 'stop' }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  }));
});

it('renders the current QR code for an admin-managed bot waiting for scan', () => {
  const initialData = createPayload();
  initialData.bot.status = 'waiting_for_qr';
  initialData.bot.lastQrCodeId = 'qr_1';
  initialData.bot.lastQrCodeUrl = 'https://liteapp.weixin.qq.com/q/example?qrcode=qr_1';

  renderWithLocale(<AdminBotDetailConsole initialData={initialData} />, { locale: 'en' });

  expect(screen.getByRole('img', { name: 'qr_1' })).toHaveAttribute(
    'src',
    expect.stringContaining('/api/qrcode?value='),
  );
  expect(screen.getByRole('button', { name: 'Reissue QR' })).toBeInTheDocument();
});

it('allows an administrator to delete a fully stopped bot', async () => {
  const initialData = createPayload();
  initialData.bot.desiredState = 'stopped';
  initialData.bot.status = 'stopped';
  initialData.bot.processPid = null;
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({ data: { id: initialData.bot.id }, error: null }),
    ok: true,
  });
  vi.stubGlobal('fetch', fetchMock);
  renderWithLocale(<AdminBotDetailConsole initialData={initialData} />, { locale: 'en' });

  await userEvent.click(screen.getByRole('button', { name: 'Delete bot' }));
  expect(screen.getByText('Delete bot?')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/bots/bot_1', { method: 'DELETE' }));
  await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith('/admin/bots'));
});

function createPayload(): AdminBotDetailPayload {
  return {
    agentConfig: {
      globalRevision: 2,
      history: [],
      override: {
        active: false,
        agentsAppendix: '',
        changeReason: null,
        revision: 0,
        soulAppendix: '',
        updatedAt: null,
        updatedByEmail: null,
      },
      projection: {
        appliedGlobalRevision: 2,
        appliedOverrideRevision: 0,
        lastSyncError: null,
        lastSyncedAt: '2026-07-20T01:00:00.000Z',
        syncStatus: 'synced',
      },
    },
    bot: {
      createdAt: '2026-07-20T00:00:00.000Z', desiredState: 'running', heartbeatAt: null, id: 'bot_1',
      lastErrorCode: null, lastErrorMessage: null, lastQrCodeId: null, lastQrCodeUrl: null,
      llmConfigId: 'profile_1', llmProfileName: 'Default', model: 'Qwen3.7 Plus', name: 'Morning Bot',
      processPid: 123, processStartedAt: null, provider: 'opencode', qrReissueRequestedAt: null,
      restartRequestedAt: null, status: 'running', updatedAt: '2026-07-20T01:00:00.000Z',
      weixinAccountId: null, workspaceId: 'workspace_1',
    },
    events: [],
    inventory: {
      createdAt: '2026-07-20T00:00:00.000Z', desiredState: 'running', id: 'bot_1', model: 'Qwen3.7 Plus',
      morningBriefing: {
        adminEnabled: true, appliedRevision: 1, centralLastDeliveredAt: null,
        centralLastDeliveryDate: null, centralLastError: null,
        centralScheduledFor: '2027-07-27T00:30:00.000Z', deliveryTime: '08:30', desiredRevision: 2,
        forceEnabled: false, lastSyncError: null, lastSyncedAt: null, location: '北京',
        observedUserOptOut: false, runtimeNeedsCleanup: false, runtimeNeedsSchedule: false,
        runtimeObservedAt: '2026-07-20T01:00:00.000Z', runtimeScheduledFor: '2027-07-27T00:30:00.000Z',
        scheduleStatus: 'scheduled', syncStatus: 'pending', timezone: 'Asia/Shanghai',
      },
      name: 'Morning Bot', ownerEmail: 'employee@example.com', ownerUserId: 'user_1', provider: 'opencode',
      status: 'running', updatedAt: '2026-07-20T01:00:00.000Z',
    },
    wecomBinding: {
      botId: 'bot_1', botName: 'Morning Bot', bound: false, employeeId: null,
      employeeName: null, enabled: false, lastError: null, lastInboundAt: null,
      lastOutboundAt: null, ownerEmail: 'employee@example.com', ownerUserId: 'user_1',
      preferredForProactive: true, updatedAt: null, wecomUserId: '',
    },
  };
}
