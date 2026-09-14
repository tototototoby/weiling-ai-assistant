'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Send } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { SectionCard } from '@/components/layout/section-card';
import { useLocale } from '@/components/providers/locale-provider';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { cn } from '@/lib/utils';

interface WebChatPanelProps {
  botId: string;
}

interface ToolCallDisplay {
  input?: unknown;
  output?: unknown;
  toolCallId: string;
  toolName: string;
}

interface ChatMessage {
  content: string;
  id: string;
  role: 'assistant' | 'user';
  toolCalls?: ToolCallDisplay[];
}

interface HistoryMessage {
  content: string;
  id: string;
  role: 'assistant' | 'user';
  toolEventsJson: string | null;
}

export function WebChatPanel({ botId }: WebChatPanelProps) {
  const { t } = useLocale();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/bots/${botId}/chat/messages`, { cache: 'no-store' });
        const payload = await response.json() as {
          data: { messages: HistoryMessage[] } | null;
          error: { message: string } | null;
        };
        if (cancelled) {
          return;
        }
        if (!response.ok || !payload.data) {
          setErrorMessage(payload.error?.message ?? t((messages) => messages.webChat.loadFailed));
          return;
        }
        setMessages(payload.data.messages.map((message) => ({
          ...message,
          toolCalls: parseToolEvents(message.toolEventsJson),
        })));
      } catch {
        if (!cancelled) {
          setErrorMessage(t((messages) => messages.webChat.loadFailed));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [botId, t]);

  useEffect(() => {
    const element = bottomRef.current;
    if (element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isSending]);

  const canSend = input.trim().length > 0 && !isSending;

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isSending) {
      return;
    }
    setInput('');
    setErrorMessage(null);
    setIsSending(true);
    const userMessage: ChatMessage = {
      content: text,
      id: `user-${Date.now()}`,
      role: 'user',
    };
    setMessages((current) => [...current, userMessage]);

    const assistantId = `assistant-${Date.now()}`;
    const assistantMessage: ChatMessage = {
      content: '',
      id: assistantId,
      role: 'assistant',
      toolCalls: [],
    };
    setMessages((current) => [...current, assistantMessage]);

    try {
      const response = await fetch(`/api/bots/${botId}/chat`, {
        body: JSON.stringify({
          botId,
          messages: [{ content: text, role: 'user' }],
          text,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      if (response.status === 409) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        setErrorMessage(payload?.error?.message ?? t((messages) => messages.webChat.botNotRunning));
        setMessages((current) => current.filter((message) => message.id !== assistantId));
        return;
      }
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      await streamAssistantReply(response, assistantId, (update) => {
        setMessages((current) => current.map((message) => {
          if (message.id !== assistantId) {
            return message;
          }
          return { ...message, ...update };
        }));
      });
    } catch {
      setErrorMessage(t((messages) => messages.webChat.sendFailed));
      setMessages((current) => current.filter((message) => message.id !== assistantId));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <SectionCard
      contentClassName="grid gap-4"
      description={t((messages) => messages.webChat.description)}
      title={t((messages) => messages.webChat.title)}
    >
      {errorMessage ? <ErrorNotice>{errorMessage}</ErrorNotice> : null}
      <div className="grid max-h-[28rem] min-h-[18rem] content-start gap-3 overflow-y-auto rounded-[var(--radius-control)] border border-[color:var(--border-soft)] bg-[color:var(--surface-muted)]/45 p-4">
        {messages.length === 0 && !isSending ? (
          <p className="m-0 py-8 text-center text-sm text-muted-foreground">
            {t((messages) => messages.webChat.inputPlaceholder)}
          </p>
        ) : null}
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {isSending ? (
          <div className="flex justify-start">
            <span className="rounded-[var(--radius-control)] border border-[color:var(--border-soft)] bg-[color:var(--surface)] px-3 py-2 text-xs text-muted-foreground">
              {t((messages) => messages.webChat.sending)}
            </span>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>
      <div className="grid gap-2">
        <textarea
          className="min-h-20 w-full resize-y rounded-[var(--radius-control)] border border-[color:var(--border-soft)] bg-[color:var(--surface)] px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-[color:var(--border-strong)]"
          disabled={isSending}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void sendMessage();
            }
          }}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t((messages) => messages.webChat.inputPlaceholder)}
          value={input}
        />
        <div className="flex justify-end">
          <Button disabled={!canSend} onClick={() => void sendMessage()} type="button">
            <Send className="h-4 w-4" />
            {t((messages) => messages.webChat.send)}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const { t } = useLocale();
  const isUser = message.role === 'user';

  return (
    <div
      className={cn(
        'flex max-w-[85%] items-start gap-2',
        isUser ? 'justify-self-end' : 'justify-self-start',
      )}
    >
      {!isUser ? (
        <img
          alt={t((messages) => messages.chat.title)}
          className="mt-0.5 h-6 w-6 shrink-0 rounded-full object-cover"
          decoding="async"
          src="/brand/weiling-mark.png"
          width="24"
          height="24"
        />
      ) : null}
      <div className="grid min-w-0 gap-2">
        <div
          className={cn(
            'rounded-[var(--radius-control)] border px-3 py-2 text-sm leading-6',
            isUser
              ? 'border-[color:var(--border-soft)] bg-[color:var(--accent-soft)] text-foreground'
              : 'border-[color:var(--border-soft)] bg-[color:var(--surface)] text-foreground',
          )}
        >
          {isUser ? message.content : (
            <div className="prose-sm">
              <ReactMarkdown>{message.content || ' '}</ReactMarkdown>
            </div>
          )}
        </div>
        {message.toolCalls && message.toolCalls.length > 0 ? (
          <div className="grid gap-2">
            {message.toolCalls.map((toolCall, index) => (
              <ToolCallCard key={`${message.id}-${toolCall.toolCallId}-${index}`} toolCall={toolCall} />
            ))}
          </div>
        ) : null}
        {!isUser && !message.content && message.toolCalls?.length ? (
          <span className="text-xs text-muted-foreground">{t((messages) => messages.webChat.toolCardTitle)}</span>
        ) : null}
      </div>
    </div>
  );
}

function ToolCallCard({ toolCall }: { toolCall: ToolCallDisplay }) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="grid gap-2 rounded-[var(--radius-control)] border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-3">
      <button
        className="flex items-center justify-between gap-2 text-left text-xs font-semibold text-foreground"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <span>{toolCall.toolName}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded ? 'rotate-180' : '')} />
      </button>
      {expanded ? (
        <div className="grid gap-2 text-xs">
          <JsonBlock label={t((messages) => messages.webChat.toolInputLabel)} value={toolCall.input} />
          {toolCall.output !== undefined ? (
            <JsonBlock label={t((messages) => messages.webChat.toolOutputLabel)} value={toolCall.output} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="grid gap-1">
      <span className="text-[color:var(--text-soft)]">{label}</span>
      <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-[var(--radius-control)] bg-[color:var(--surface-muted)] p-2 text-[11px] leading-5 text-foreground">
        {formatJson(value)}
      </pre>
    </div>
  );
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseToolEvents(toolEventsJson: string | null): ToolCallDisplay[] | undefined {
  if (!toolEventsJson) {
    return undefined;
  }
  try {
    const events = JSON.parse(toolEventsJson) as Array<{
      input?: unknown;
      output?: unknown;
      toolCallId: string;
      toolName: string;
      type: string;
    }>;
    return events
      .filter((event) => event.type === 'tool_call')
      .map((event) => ({
        input: event.input,
        output: events.find((other) => other.toolCallId === event.toolCallId && other.type === 'tool_result')?.output,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
      }));
  } catch {
    return undefined;
  }
}

async function streamAssistantReply(
  response: Response,
  assistantId: string,
  applyUpdate: (update: Partial<ChatMessage>) => void,
): Promise<void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const toolCalls: ToolCallDisplay[] = [];
  let toolByName: Record<string, ToolCallDisplay> = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let frameEnd = buffer.indexOf('\n\n');
    while (frameEnd >= 0) {
      const frame = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);
      applyFrame(frame);
      frameEnd = buffer.indexOf('\n\n');
    }
  }

  function applyFrame(frame: string) {
    const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
    if (!dataLine) {
      return;
    }
    const raw = dataLine.slice('data:'.length).trim();
    if (raw === '[DONE]') {
      return;
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (payload.type === 'text-delta' && typeof payload.delta === 'string') {
      content += payload.delta;
      applyUpdate({ content });
    } else if (payload.type === 'tool-input-available') {
      const toolCallId = String(payload.toolCallId ?? '');
      const toolCall: ToolCallDisplay = {
        input: payload.input,
        toolCallId,
        toolName: String(payload.toolName ?? ''),
      };
      toolByName = { ...toolByName, [toolCallId]: toolCall };
      toolCalls.push(toolCall);
      applyUpdate({ toolCalls: [...toolCalls] });
    } else if (payload.type === 'tool-output-available') {
      const toolCallId = String(payload.toolCallId ?? '');
      const existing = toolByName[toolCallId];
      if (existing) {
        existing.output = payload.output;
        applyUpdate({ toolCalls: [...toolCalls] });
      }
    } else if (payload.type === 'error') {
      throw new Error(String(payload.errorText ?? ''));
    }
  }
}
