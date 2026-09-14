import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { WebChatMessageRole, WebChatMessageStatus } from '../schema/web-chat-messages';
import { webChatMessages } from '../schema/web-chat-messages';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;
const WEB_CHAT_MESSAGE_ROW_ID = sql<number>`rowid`;

export interface CreateWebChatMessageInput {
  botInstanceId: string;
  ownerUserId?: string | null;
  role: WebChatMessageRole;
  content: string;
  requestId?: string | null;
  toolEventsJson?: string | null;
  status?: WebChatMessageStatus;
  createdAt?: Date;
}

export interface WebChatMessageRecord {
  id: string;
  botInstanceId: string;
  ownerUserId: string | null;
  role: WebChatMessageRole;
  content: string;
  toolEventsJson: string | null;
  requestId: string | null;
  status: WebChatMessageStatus;
  createdAt: Date;
  updatedAt: Date;
}

export class WebChatMessageRepository {
  constructor(private readonly db: Db) {}

  async create(input: CreateWebChatMessageInput): Promise<WebChatMessageRecord> {
    const now = input.createdAt ?? new Date();
    const record: WebChatMessageRecord = {
      id: randomUUID(),
      botInstanceId: input.botInstanceId,
      ownerUserId: input.ownerUserId ?? null,
      role: input.role,
      content: input.content,
      toolEventsJson: input.toolEventsJson ?? null,
      requestId: input.requestId ?? null,
      status: input.status ?? 'pending',
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(webChatMessages).values(record).run();
    return record;
  }

  async findByRequestId(requestId: string): Promise<WebChatMessageRecord | null> {
    return this.db.select().from(webChatMessages)
      .where(and(eq(webChatMessages.requestId, requestId), isNotNull(webChatMessages.requestId)))
      .get() ?? null;
  }

  async listByBotInstanceId(botInstanceId: string, limit = 50): Promise<WebChatMessageRecord[]> {
    return this.db.select().from(webChatMessages)
      .where(eq(webChatMessages.botInstanceId, botInstanceId))
      .orderBy(desc(WEB_CHAT_MESSAGE_ROW_ID))
      .limit(limit)
      .all()
      .reverse();
  }

  async markStreaming(id: string, updatedAt: Date = new Date()): Promise<void> {
    this.db.update(webChatMessages).set({
      status: 'streaming',
      updatedAt,
    }).where(eq(webChatMessages.id, id)).run();
  }

  async markResult(
    id: string,
    input: {
      content: string;
      toolEventsJson: string | null;
      status: 'succeeded' | 'failed';
      updatedAt?: Date;
    },
  ): Promise<void> {
    this.db.update(webChatMessages).set({
      content: input.content,
      toolEventsJson: input.toolEventsJson,
      status: input.status,
      updatedAt: input.updatedAt ?? new Date(),
    }).where(eq(webChatMessages.id, id)).run();
  }
}
