import type { BotDetailItem, BotEventCursor, BotEventItem } from './bot-service';
import { toApiError } from './api-error';

const encoder = new TextEncoder();
const KEEPALIVE_INTERVAL_MS = 10_000;

interface SseFrame {
  comment?: string;
  data?: unknown;
  event?: string;
}

export interface BotStreamDependencies {
  botId: string;
  getBotDetail(botId: string): Promise<BotDetailItem>;
  listBotEvents(botId: string): Promise<BotEventItem[]>;
  listBotEventsAfterCursor(
    botId: string,
    cursor: BotEventCursor | null,
  ): Promise<BotEventItem[]>;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

interface BotStreamErrorPayload {
  id: string;
  message: string;
}

export function createBotStreamResponse({
  botId,
  getBotDetail,
  listBotEvents,
  listBotEventsAfterCursor,
  pollIntervalMs = 2_000,
  signal,
}: BotStreamDependencies): Response {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let lastKeepaliveAt = Date.now();
  let lastStatusSignature = '';
  let lastQrSignature = '';
  let lastErrorSignature = '';
  let lastEventCursor: BotEventCursor | null = null;

  const cleanup = () => {
    closed = true;

    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  signal?.addEventListener('abort', cleanup, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (frame: SseFrame) => {
        controller.enqueue(encodeFrame(frame));
      };

      const sendSnapshot = async () => {
        const bot = await getBotDetail(botId);
        const events = await listBotEvents(botId);

        lastStatusSignature = createStatusSignature(bot);
        lastQrSignature = createQrSignature(bot);
        lastErrorSignature = createErrorSignature(bot);
        lastEventCursor = getLatestCursor(events);

        enqueue({
          event: 'bot.status.updated',
          data: bot,
        });
      };

      const poll = async () => {
        if (closed) {
          return;
        }

        try {
          const bot = await getBotDetail(botId);
          const statusSignature = createStatusSignature(bot);
          const qrSignature = createQrSignature(bot);
          const errorSignature = createErrorSignature(bot);

          if (statusSignature !== lastStatusSignature) {
            lastStatusSignature = statusSignature;
            enqueue({
              event: 'bot.status.updated',
              data: bot,
            });
          }

          if (qrSignature !== lastQrSignature) {
            lastQrSignature = qrSignature;
            enqueue({
              event: 'bot.qrcode.updated',
              data: {
                id: bot.id,
                lastQrCodeId: bot.lastQrCodeId,
                lastQrCodeUrl: bot.lastQrCodeUrl,
                qrCodeIssuedAt: bot.qrCodeIssuedAt,
              },
            });
          }

          if (errorSignature !== lastErrorSignature) {
            lastErrorSignature = errorSignature;
            enqueue({
              event: 'bot.error.updated',
              data: {
                id: bot.id,
                lastErrorCode: bot.lastErrorCode,
                lastErrorMessage: bot.lastErrorMessage,
              },
            });
          }

          const events = await listBotEventsAfterCursor(botId, lastEventCursor);

          for (const event of events) {
            lastEventCursor = {
              rowId: event.rowId,
            };
            enqueue({
              event: 'bot.event.created',
              data: event,
            });
          }

          const now = Date.now();
          if (now - lastKeepaliveAt >= KEEPALIVE_INTERVAL_MS) {
            lastKeepaliveAt = now;
            enqueue({ comment: 'keepalive' });
          }
        } catch (error) {
          enqueue({
            event: 'bot.stream.error',
            data: createStreamErrorPayload(botId, error),
          });
        }

        if (!closed) {
          timeoutId = setTimeout(() => {
            void poll();
          }, pollIntervalMs);
        }
      };

      try {
        await sendSnapshot();
        timeoutId = setTimeout(() => {
          void poll();
        }, pollIntervalMs);
      } catch (error) {
        enqueue({
          event: 'bot.stream.error',
          data: createStreamErrorPayload(botId, error),
        });
        controller.close();
        cleanup();
      }
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'content-type': 'text/event-stream; charset=utf-8',
    },
  });
}

function createStreamErrorPayload(botId: string, error: unknown): BotStreamErrorPayload {
  return {
    id: botId,
    message: toApiError(error).message,
  };
}

function encodeFrame(frame: SseFrame): Uint8Array {
  const lines: string[] = [];

  if (frame.comment) {
    lines.push(`: ${frame.comment}`);
  }

  if (frame.event) {
    lines.push(`event: ${frame.event}`);
  }

  if (frame.data !== undefined) {
    const payload = JSON.stringify(frame.data);
    for (const line of payload.split('\n')) {
      lines.push(`data: ${line}`);
    }
  }

  lines.push('');

  return encoder.encode(`${lines.join('\n')}\n`);
}

function createStatusSignature(bot: BotDetailItem): string {
  return JSON.stringify({
    desiredState: bot.desiredState,
    heartbeatAt: bot.heartbeatAt,
    lastErrorCode: bot.lastErrorCode,
    lastErrorMessage: bot.lastErrorMessage,
    lastQrCodeId: bot.lastQrCodeId,
    lastQrCodeUrl: bot.lastQrCodeUrl,
    qrCodeIssuedAt: bot.qrCodeIssuedAt,
    processPid: bot.processPid,
    processStartedAt: bot.processStartedAt,
    restartRequestedAt: bot.restartRequestedAt,
    status: bot.status,
    updatedAt: bot.updatedAt,
    weixinAccountId: bot.weixinAccountId,
  });
}

function createQrSignature(bot: BotDetailItem): string {
  return JSON.stringify({
    lastQrCodeId: bot.lastQrCodeId,
    lastQrCodeUrl: bot.lastQrCodeUrl,
  });
}

function createErrorSignature(bot: BotDetailItem): string {
  return JSON.stringify({
    lastErrorCode: bot.lastErrorCode,
    lastErrorMessage: bot.lastErrorMessage,
  });
}

function getLatestCursor(events: BotEventItem[]): BotEventCursor | null {
  if (events.length === 0) {
    return null;
  }

  return events.reduce<BotEventCursor | null>((latest, event) => {
    if (!latest) {
      return {
        rowId: event.rowId,
      };
    }

    if (event.rowId > latest.rowId) {
      return {
        rowId: event.rowId,
      };
    }

    return latest;
  }, null);
}
