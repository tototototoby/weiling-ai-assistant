// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/components/providers/locale-provider';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { WebChatPanel } from '../web-chat-panel';

vi.mock('next/navigation', () => ({
  usePathname: () => '/bots',
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.cookie = 'locale=; Max-Age=0; path=/';
  document.cookie = 'theme=; Max-Age=0; path=/';
});

function renderPanel(botId = 'bot_1') {
  return render(
    <ThemeProvider initialTheme="light">
      <LocaleProvider initialLocale="zh-CN">
        <WebChatPanel botId={botId} />
      </LocaleProvider>
    </ThemeProvider>,
  );
}

it('loads chat history on mount', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    data: {
      messages: [
        { content: '早上好', createdAt: '2026-08-12T00:00:00.000Z', id: 'm1', role: 'user', toolEventsJson: null },
        { content: '你好，有什么可以帮你？', createdAt: '2026-08-12T00:00:01.000Z', id: 'm2', role: 'assistant', toolEventsJson: null },
      ],
    },
    error: null,
  }), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);

  renderPanel();

  await waitFor(() => {
    expect(screen.getByText('早上好')).toBeInTheDocument();
    expect(screen.getByText('你好，有什么可以帮你？')).toBeInTheDocument();
  });
});

it('sends a message and renders the streamed assistant reply', async () => {
  const sse = 'data: {"type":"start","messageId":"assistant-1"}\n\n'
    + 'data: {"type":"text-start","id":"t1"}\n\n'
    + 'data: {"type":"text-delta","id":"t1","delta":"北京"}\n\n'
    + 'data: {"type":"text-delta","id":"t1","delta":"天气"}\n\n'
    + 'data: {"type":"text-end","id":"t1"}\n\n'
    + 'data: {"type":"finish"}\n\n'
    + 'data: [DONE]\n\n';
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: { messages: [] }, error: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    .mockResolvedValueOnce(new Response(sse, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));
  vi.stubGlobal('fetch', fetchMock);

  renderPanel();
  const textarea = await screen.findByPlaceholderText(/想向 Bot 说点什么/);
  await userEvent.type(textarea, '北京天气如何');
  await userEvent.click(screen.getByRole('button', { name: /发送/ }));

  await waitFor(() => {
    expect(screen.getByText('北京天气如何')).toBeInTheDocument();
    expect(screen.getByText('北京天气')).toBeInTheDocument();
  });
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/bots/bot_1/chat',
    expect.objectContaining({ method: 'POST' }),
  );
});

it('shows the bot-not-running hint on HTTP 409', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: { messages: [] }, error: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      data: null,
      error: { code: 'BOT_NOT_RUNNING', message: 'Bot process is not running.' },
    }), { status: 409, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);

  renderPanel();
  const textarea = await screen.findByPlaceholderText(/想向 Bot 说点什么/);
  await userEvent.type(textarea, '在吗');
  await userEvent.click(screen.getByRole('button', { name: /发送/ }));

  await waitFor(() => {
    expect(screen.getByText('Bot process is not running.')).toBeInTheDocument();
  });
});

it('renders collapsible tool call cards from the stream', async () => {
  const sse = 'data: {"type":"start","messageId":"assistant-1"}\n\n'
    + 'data: {"type":"tool-input-start","toolCallId":"call_1","toolName":"weather"}\n\n'
    + 'data: {"type":"tool-input-available","toolCallId":"call_1","toolName":"weather","input":{"city":"北京"}}\n\n'
    + 'data: {"type":"tool-output-available","toolCallId":"call_1","output":{"temperature":32}}\n\n'
    + 'data: {"type":"finish"}\n\n'
    + 'data: [DONE]\n\n';
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: { messages: [] }, error: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    .mockResolvedValueOnce(new Response(sse, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));
  vi.stubGlobal('fetch', fetchMock);

  renderPanel();
  const textarea = await screen.findByPlaceholderText(/想向 Bot 说点什么/);
  await userEvent.type(textarea, '查天气');
  await userEvent.click(screen.getByRole('button', { name: /发送/ }));

  await waitFor(() => {
    expect(screen.getByText('weather')).toBeInTheDocument();
  });
});
