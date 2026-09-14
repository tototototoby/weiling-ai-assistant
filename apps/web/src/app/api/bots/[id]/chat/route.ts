import { randomUUID } from 'node:crypto';
import { WebChatMessageRepository } from '@weiling-ai/db';
import { ApiError, fail } from '@/lib/api-error';
import { getDatabaseClient } from '@/lib/repositories';
import { requireOwnedBot, requireRequestSession } from '@/lib/session';
import {
  buildUiMessageStreamFrames,
  getSupervisorInternalToken,
  SupervisorBridgeError,
  supervisorTurnStream,
  type SupervisorTurnEvent,
} from '@/lib/web-chat-client';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const encoder = new TextEncoder();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const session = await requireRequestSession(request);
    const { id } = await context.params;
    await requireOwnedBot(id, session.user.id);

    if (!getSupervisorInternalToken()) {
      throw new ApiError({
        code: 'SERVER_NOT_CONFIGURED',
        message: 'Web chat is not configured.',
        status: 503,
      });
    }

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const text = extractUserText(body);
    if (!text) {
      throw new ApiError({
        code: 'INVALID_CHAT_MESSAGE',
        message: 'Message text is required.',
        status: 400,
      });
    }
    if (Buffer.byteLength(text, 'utf8') > 64 * 1024) {
      throw new ApiError({
        code: 'MESSAGE_TOO_LARGE',
        message: 'Message text must not exceed 64KB.',
        status: 400,
      });
    }

    const repository = new WebChatMessageRepository(getDatabaseClient().db);
    const requestId = randomUUID();
    const userMessage = await repository.create({
      botInstanceId: id,
      content: text,
      ownerUserId: session.user.id,
      requestId,
      role: 'user',
      status: 'pending',
    });

    const events = supervisorTurnStream(id, requestId, text);
    let firstResult: IteratorResult<SupervisorTurnEvent>;
    try {
      firstResult = await events.next();
    } catch (error) {
      await repository.markResult(userMessage.id, {
        content: text,
        status: 'failed',
        toolEventsJson: null,
      }).catch(() => undefined);
      if (error instanceof SupervisorBridgeError
        && (error.code === 'BOT_NOT_RUNNING' || error.code === 'TURN_IN_PROGRESS')) {
        return fail(new ApiError({
          code: error.code,
          message: error.message,
          status: 409,
        }));
      }
      return fail(new ApiError({
        code: 'SUPERVISOR_UNAVAILABLE',
        message: '机器人运行通道暂不可用，请稍后重试。',
        status: 502,
      }));
    }

    const assistantMessageId = randomUUID();
    const textBlockId = `${assistantMessageId}_text`;
    const stream = createChatStream({
      assistantMessageId,
      botInstanceId: id,
      events: prependResult(firstResult, events),
      ownerUserId: session.user.id,
      repository,
      text,
      textBlockId,
      userMessageId: userMessage.id,
    });

    return new Response(stream, {
      headers: {
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'content-type': 'text/event-stream; charset=utf-8',
        'x-vercel-ai-ui-message-stream': 'v1',
      },
    });
  } catch (error) {
    return fail(error);
  }
}

interface CreateChatStreamDependencies {
  assistantMessageId: string;
  botInstanceId: string;
  events: AsyncIterable<SupervisorTurnEvent>;
  ownerUserId: string;
  repository: WebChatMessageRepository;
  text: string;
  textBlockId: string;
  userMessageId: string;
}

function createChatStream(dependencies: CreateChatStreamDependencies): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (line: string) => {
        controller.enqueue(encoder.encode(line));
      };
      let finalText = '';
      const toolEvents: SupervisorTurnEvent[] = [];

      try {
        const aggregated = aggregateEvents(dependencies.events, (event) => {
          if (event.type === 'text_delta') {
            finalText += event.delta;
          } else if (event.type === 'message_end' && event.text) {
            finalText = event.text;
          } else if (event.type === 'tool_call' || event.type === 'tool_result') {
            toolEvents.push(event);
          }
        });
        const frames = buildUiMessageStreamFrames(aggregated, {
          assistantMessageId: dependencies.assistantMessageId,
          textBlockId: dependencies.textBlockId,
        });
        for await (const frame of frames) {
          enqueue(frame);
        }

        await dependencies.repository.markResult(dependencies.userMessageId, {
          content: dependencies.text,
          status: 'succeeded',
          toolEventsJson: null,
        });
        await dependencies.repository.create({
          botInstanceId: dependencies.botInstanceId,
          content: finalText || '（本次没有生成回复内容）',
          ownerUserId: dependencies.ownerUserId,
          role: 'assistant',
          status: 'succeeded',
          toolEventsJson: toolEvents.length > 0 ? JSON.stringify(toolEvents) : null,
        });
      } catch (error) {
        await dependencies.repository.markResult(dependencies.userMessageId, {
          content: dependencies.text,
          status: 'failed',
          toolEventsJson: null,
        }).catch(() => undefined);
        enqueue(`data: ${JSON.stringify({
          errorText: error instanceof Error ? error.message : '回复失败，请重试。',
          type: 'error',
        })}\n\n`);
        enqueue('data: [DONE]\n\n');
      } finally {
        controller.close();
      }
    },
    cancel() {
      // The supervisor turn continues server-side; the client may reconnect later.
    },
  });
}

async function* aggregateEvents(
  events: AsyncIterable<SupervisorTurnEvent>,
  onEvent: (event: SupervisorTurnEvent) => void,
): AsyncGenerator<SupervisorTurnEvent> {
  for await (const event of events) {
    onEvent(event);
    yield event;
  }
}

async function* prependResult<T>(
  first: IteratorResult<T>,
  rest: AsyncIterable<T>,
): AsyncGenerator<T> {
  if (!first.done && first.value !== undefined) {
    yield first.value;
  }
  yield* rest;
}

function extractUserText(body: Record<string, unknown> | null): string | null {
  if (!body) {
    return null;
  }
  if (typeof body.text === 'string' && body.text.trim()) {
    return body.text.trim();
  }
  if (Array.isArray(body.messages)) {
    for (let index = body.messages.length - 1; index >= 0; index -= 1) {
      const message = body.messages[index];
      if (typeof message !== 'object' || message === null) {
        continue;
      }
      const candidate = message as { content?: unknown; parts?: unknown; role?: unknown };
      if (candidate.role !== 'user') {
        continue;
      }
      const content = extractTextContent(candidate.content) ?? extractPartsText(candidate.parts);
      if (content) {
        return content;
      }
    }
  }
  return null;
}

function extractPartsText(parts: unknown): string | null {
  if (!Array.isArray(parts)) {
    return null;
  }
  let text = '';
  for (const part of parts) {
    if (typeof part !== 'object' || part === null) {
      continue;
    }
    const candidate = part as { text?: unknown; type?: unknown };
    if (candidate.type === 'text' && typeof candidate.text === 'string') {
      text += candidate.text;
    }
  }
  return text.trim() || null;
}

function extractTextContent(content: unknown): string | null {
  if (typeof content === 'string' && content.trim()) {
    return content.trim();
  }
  return null;
}
