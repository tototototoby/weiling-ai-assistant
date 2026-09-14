import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildUiMessageStreamFrames,
  parseSseFrame,
  SupervisorBridgeError,
  supervisorTurnStream,
  type SupervisorTurnEvent,
} from '../web-chat-client';

describe('web-chat-client protocol helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('parses supervisor SSE frames into typed events', () => {
    expect(parseSseFrame('event: turn_start\ndata: {}')).toEqual({ type: 'turn_start' });
    expect(parseSseFrame('event: text_delta\ndata: {"delta":"北京"}')).toEqual({
      type: 'text_delta',
      delta: '北京',
    });
    expect(parseSseFrame(
      'event: tool_call\ndata: {"toolCallId":"call_1","toolName":"weather","input":{"city":"北京"}}',
    )).toEqual({
      type: 'tool_call',
      toolCallId: 'call_1',
      toolName: 'weather',
      input: { city: '北京' },
    });
    expect(parseSseFrame('event: message_end\ndata: {"text":"ok"}')).toEqual({
      type: 'message_end',
      text: 'ok',
    });
    expect(parseSseFrame('event: error\ndata: {"message":"failed"}')).toEqual({
      type: 'error',
      message: 'failed',
    });
    expect(parseSseFrame(': keepalive\n\n')).toBeNull();
    expect(parseSseFrame('event: unknown\ndata: {"x":1}')).toBeNull();
  });

  it('translates supervisor events into AI SDK UI-message-stream frames', async () => {
    const events: SupervisorTurnEvent[] = [
      { type: 'turn_start' },
      { type: 'text_delta', delta: '你' },
      { type: 'text_delta', delta: '好' },
      {
        type: 'tool_call',
        toolCallId: 'call_1',
        toolName: 'weather',
        input: { city: '北京' },
      },
      { type: 'tool_result', toolCallId: 'call_1', output: { temperature: 32 } },
      { type: 'message_end', text: '你好' },
    ];

    const frames: string[] = [];
    for await (const frame of buildUiMessageStreamFrames(events, {
      assistantMessageId: 'msg_1',
      textBlockId: 'msg_1_text',
    })) {
      frames.push(frame);
    }

    expect(frames).toEqual([
      'data: {"messageId":"msg_1","type":"start"}\n\n',
      'data: {"id":"msg_1_text","type":"text-start"}\n\n',
      'data: {"delta":"你","id":"msg_1_text","type":"text-delta"}\n\n',
      'data: {"delta":"好","id":"msg_1_text","type":"text-delta"}\n\n',
      'data: {"toolCallId":"call_1","toolName":"weather","type":"tool-input-start"}\n\n',
      'data: {"input":{"city":"北京"},"toolCallId":"call_1","toolName":"weather","type":"tool-input-available"}\n\n',
      'data: {"output":{"temperature":32},"toolCallId":"call_1","type":"tool-output-available"}\n\n',
      'data: {"id":"msg_1_text","type":"text-end"}\n\n',
      'data: {"type":"finish-step"}\n\n',
      'data: {"type":"finish"}\n\n',
      'data: [DONE]\n\n',
    ]);
  });

  it('emits an error frame and finishes when the supervisor reports a runtime error', async () => {
    const events: SupervisorTurnEvent[] = [
      { type: 'text_delta', delta: '前' },
      { type: 'error', message: 'model unavailable' },
    ];

    const frames: string[] = [];
    for await (const frame of buildUiMessageStreamFrames(events, {
      assistantMessageId: 'msg_2',
      textBlockId: 'msg_2_text',
    })) {
      frames.push(frame);
    }

    expect(frames).toContain('data: {"errorText":"model unavailable","type":"error"}\n\n');
    expect(frames[frames.length - 1]).toBe('data: [DONE]\n\n');
  });

  it('throws SERVER_NOT_CONFIGURED when the bridge token is missing', async () => {
    vi.stubEnv('WECLAWS_INTERNAL_API_TOKEN', '');
    await expect(collectEvents(supervisorTurnStream('bot_1', 'r1', 'hi')))
      .rejects.toThrow('Web chat bridge is not configured.');
  });

  it('maps a 409 bridge response to a typed SupervisorBridgeError', async () => {
    vi.stubEnv('WECLAWS_INTERNAL_API_TOKEN', 'secret');
    vi.stubEnv('SUPERVISOR_INTERNAL_URL', 'http://supervisor:8790');
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: 'BOT_NOT_RUNNING', message: 'Bot process is not running.' }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(collectEvents(supervisorTurnStream('bot_1', 'r1', 'hi')))
      .rejects.toMatchObject({
        code: 'BOT_NOT_RUNNING',
        name: 'SupervisorBridgeError',
      });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://supervisor:8790/internal/web-chat/turns',
      expect.objectContaining({
        body: JSON.stringify({ botInstanceId: 'bot_1', requestId: 'r1', text: 'hi' }),
        headers: {
          authorization: 'Bearer secret',
          'content-type': 'application/json',
        },
        method: 'POST',
      }),
    );
  });

  it('yields normalized events from a successful supervisor SSE stream', async () => {
    vi.stubEnv('WECLAWS_INTERNAL_API_TOKEN', 'secret');
    const sse = 'event: turn_start\ndata: {}\n\n'
      + 'event: text_delta\ndata: {"delta":"hi"}\n\n'
      + 'event: message_end\ndata: {"text":"hi"}\n\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(sse, {
      headers: { 'content-type': 'text/event-stream' },
      status: 200,
    })));

    await expect(collectEvents(supervisorTurnStream('bot_1', 'r1', 'hi'))).resolves.toEqual([
      { type: 'turn_start' },
      { type: 'text_delta', delta: 'hi' },
      { type: 'message_end', text: 'hi' },
    ]);
  });
});

async function collectEvents(stream: AsyncIterable<SupervisorTurnEvent>): Promise<SupervisorTurnEvent[]> {
  const events: SupervisorTurnEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}
