// @vitest-environment jsdom

import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(),
}));

vi.mock('@/lib/session', () => ({
  requireOwnedBot: vi.fn().mockResolvedValue({
    id: 'bot_1',
    ownerUserId: 'user_1',
  }),
  requireServerSession: vi.fn().mockResolvedValue({
    user: { id: 'user_1', email: 'zac@example.com' },
  }),
}));

vi.mock('@/lib/bot-service', () => ({
  getBotDetail: vi.fn().mockResolvedValue({
    id: 'bot_1',
    llmConfigId: 'profile_1',
    llmProfileName: 'Primary',
    name: 'Alpha',
    provider: 'openai',
    model: 'gpt-5.4',
    workspaceId: 'ws_1',
    desiredState: 'stopped',
    status: 'stopped',
    processPid: null,
    processStartedAt: null,
    heartbeatAt: null,
    restartRequestedAt: null,
    lastQrCodeId: null,
    lastQrCodeUrl: null,
    weixinAccountId: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: '2026-04-13T00:00:00.000Z',
    updatedAt: '2026-04-13T00:00:00.000Z',
  }),
  listBotEvents: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/llm-profiles', () => ({
  listUserLlmProfiles: vi.fn().mockResolvedValue([
    {
      apiType: 'openai-responses',
      baseUrl: 'https://gateway.example.com/v1',
      createdAt: '2026-04-17T02:00:00.000Z',
      hasApiKey: true,
      id: 'profile_1',
      model: 'gpt-5.4',
      name: 'Primary',
      provider: 'openai',
      updatedAt: '2026-04-17T03:00:00.000Z',
    },
  ]),
}));

vi.mock('@/lib/locale', () => ({
  getMessages: () => ({
    botDetail: {
      backToBots: 'Back to bots',
    },
  }),
  getRequestLocale: vi.fn().mockResolvedValue('en'),
}));

vi.mock('@/components/bots/bot-detail-live-view', () => ({
  BotDetailLiveView: () => <div>live-view</div>,
}));

vi.mock('@/components/providers/locale-provider', () => ({
  useLocale: () => ({
    locale: 'en',
    messages: {
      webChat: {
        description: 'Chat with your assistant',
        title: 'Web Chat',
      },
    },
    t: (selector: (messages: never) => unknown) => selector({
      webChat: {
        description: 'Chat with your assistant',
        title: 'Web Chat',
      },
    } as never),
  }),
}));

describe('BotDetailPage', () => {
  it('right aligns the back-to-bots action', async () => {
    const { default: BotDetailPage } = await import('../page');

    render(await BotDetailPage({
      params: Promise.resolve({ id: 'bot_1' }),
    }));

    const button = screen.getByRole('link', { name: 'Back to bots' });
    const actionRow = button.parentElement;

    expect(actionRow).toHaveClass('justify-end');
  });
});
