export type SupervisorTurnEvent =
  | { type: 'error'; message: string }
  | { type: 'message_end'; text: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool_result'; toolCallId: string; output: unknown }
  | { type: 'turn_start' };

export interface UiMessageStreamOptions {
  assistantMessageId: string;
  textBlockId: string;
}

export class SupervisorBridgeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SupervisorBridgeError';
  }
}

export function getSupervisorInternalUrl(): string {
  return process.env.SUPERVISOR_INTERNAL_URL?.trim() || 'http://supervisor:8790';
}

export function getSupervisorInternalToken(): string | null {
  const token = process.env.WEILING_INTERNAL_API_TOKEN?.trim()
    || process.env.WECLAWS_INTERNAL_API_TOKEN?.trim();
  return token || null;
}

export async function* supervisorTurnStream(
  botInstanceId: string,
  requestId: string,
  text: string,
  options: { signal?: AbortSignal } = {},
): AsyncGenerator<SupervisorTurnEvent> {
  const token = getSupervisorInternalToken();
  if (!token) {
    throw new SupervisorBridgeError('SERVER_NOT_CONFIGURED', 'Web chat bridge is not configured.');
  }

  let response: Response;
  try {
    response = await fetch(`${getSupervisorInternalUrl()}/internal/web-chat/turns`, {
      body: JSON.stringify({ botInstanceId, requestId, text }),
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      signal: options.signal,
    });
  } catch (error) {
    throw new SupervisorBridgeError(
      'SUPERVISOR_UNAVAILABLE',
      error instanceof Error ? error.message : 'Unable to reach the bot runtime bridge.',
    );
  }

  if (!response.ok || !response.body) {
    let code = 'SUPERVISOR_UNAVAILABLE';
    let message = `Bot runtime bridge returned HTTP ${response.status}.`;
    try {
      const payload = await response.json() as { code?: string; message?: string };
      code = payload.code ?? code;
      message = payload.message ?? message;
    } catch {
      // Keep the fallback message when the bridge did not return JSON.
    }
    throw new SupervisorBridgeError(code, message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

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
      const event = parseSseFrame(frame);
      if (event) {
        yield event;
      }
      frameEnd = buffer.indexOf('\n\n');
    }
  }
}

export function parseSseFrame(frame: string): SupervisorTurnEvent | null {
  let eventName = '';
  let dataLine = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLine += line.slice('data:'.length).trim();
    }
  }
  if (!eventName || !dataLine) {
    return null;
  }
  try {
    const data = JSON.parse(dataLine) as Record<string, unknown>;
    if (eventName === 'turn_start') {
      return { type: 'turn_start' };
    }
    if (eventName === 'text_delta') {
      return { type: 'text_delta', delta: String(data.delta ?? '') };
    }
    if (eventName === 'tool_call') {
      return {
        type: 'tool_call',
        toolCallId: String(data.toolCallId ?? ''),
        toolName: String(data.toolName ?? ''),
        input: data.input,
      };
    }
    if (eventName === 'tool_result') {
      return {
        type: 'tool_result',
        toolCallId: String(data.toolCallId ?? ''),
        output: data.output,
      };
    }
    if (eventName === 'message_end') {
      return { type: 'message_end', text: String(data.text ?? '') };
    }
    if (eventName === 'error') {
      return { type: 'error', message: String(data.message ?? 'Bot runtime error.') };
    }
  } catch {
    return null;
  }
  return null;
}

export async function* buildUiMessageStreamFrames(
  events: AsyncIterable<SupervisorTurnEvent> | Iterable<SupervisorTurnEvent>,
  options: UiMessageStreamOptions,
): AsyncGenerator<string> {
  let textStarted = false;
  let finishSent = false;

  for await (const event of events) {
    if (event.type === 'turn_start') {
      yield sseData({ messageId: options.assistantMessageId, type: 'start' });
      continue;
    }
    if (event.type === 'text_delta') {
      if (!textStarted) {
        textStarted = true;
        yield sseData({ id: options.textBlockId, type: 'text-start' });
      }
      yield sseData({ delta: event.delta, id: options.textBlockId, type: 'text-delta' });
      continue;
    }
    if (event.type === 'tool_call') {
      yield sseData({
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        type: 'tool-input-start',
      });
      yield sseData({
        input: event.input ?? {},
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        type: 'tool-input-available',
      });
      continue;
    }
    if (event.type === 'tool_result') {
      yield sseData({
        output: event.output ?? {},
        toolCallId: event.toolCallId,
        type: 'tool-output-available',
      });
      continue;
    }
    if (event.type === 'message_end') {
      if (textStarted) {
        yield sseData({ id: options.textBlockId, type: 'text-end' });
      }
      yield sseData({ type: 'finish-step' });
      yield sseData({ type: 'finish' });
      finishSent = true;
      continue;
    }
    if (event.type === 'error') {
      if (textStarted) {
        yield sseData({ id: options.textBlockId, type: 'text-end' });
      }
      yield sseData({ errorText: event.message, type: 'error' });
    }
  }

  if (!finishSent) {
    yield sseData({ type: 'finish' });
  }
  yield 'data: [DONE]\n\n';
}

function sseData(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}
