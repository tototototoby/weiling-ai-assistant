import { and, asc, count, desc, eq, gte, gt, lte, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { botEvents } from '../schema/bot-events';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;
const BOT_EVENT_ROW_ID = sql<number>`rowid`;

export interface AppendBotEventInput {
  id: string;
  botInstanceId: string;
  type: string;
  message: string;
  payloadJson: Record<string, unknown>;
}

export interface BotEventCursor {
  rowId: number;
}

export interface BotEventRecord {
  rowId: number;
  id: string;
  botInstanceId: string;
  type: string;
  message: string;
  payloadJson: Record<string, unknown>;
  createdAt: Date;
}

export class BotEventRepository {
  constructor(private readonly db: Db) {}

  async append(input: AppendBotEventInput): Promise<BotEventRecord> {
    const createdAt = new Date();
    const result = this.db.insert(botEvents).values({
      ...input,
      payloadJson: JSON.stringify(input.payloadJson),
      createdAt,
    }).run();

    const rowId = Number(result.lastInsertRowid);
    return {
      ...input,
      createdAt,
      rowId,
    };
  }

  async listByBotInstanceId(botInstanceId: string): Promise<BotEventRecord[]> {
    return this.selectByBotInstanceId(eq(botEvents.botInstanceId, botInstanceId), 'desc');
  }

  async listByBotInstanceIdAfterCursor(
    botInstanceId: string,
    cursor: BotEventCursor | null,
  ): Promise<BotEventRecord[]> {
    const filter = cursor
      ? and(
        eq(botEvents.botInstanceId, botInstanceId),
        gt(BOT_EVENT_ROW_ID, cursor.rowId),
      )
      : eq(botEvents.botInstanceId, botInstanceId);

    return this.selectByBotInstanceId(filter, 'asc');
  }

  async countByTypeBetween(type: string, from: Date, to: Date): Promise<number> {
    const rows = this.db.select({ value: count() })
      .from(botEvents)
      .where(and(
        eq(botEvents.type, type),
        gte(botEvents.createdAt, from),
        lte(botEvents.createdAt, to),
      ))
      .all();
    return rows[0]?.value ?? 0;
  }

  private selectByBotInstanceId(
    filter: ReturnType<typeof eq> | ReturnType<typeof and>,
    direction: 'asc' | 'desc',
  ) {
    const rows = this.db.select({
      rowId: BOT_EVENT_ROW_ID,
      id: botEvents.id,
      botInstanceId: botEvents.botInstanceId,
      type: botEvents.type,
      message: botEvents.message,
      payloadJson: botEvents.payloadJson,
      createdAt: botEvents.createdAt,
    }).from(botEvents)
      .where(filter)
      .orderBy(
        direction === 'asc' ? asc(BOT_EVENT_ROW_ID) : desc(BOT_EVENT_ROW_ID),
      )
      .all();

    return rows.map((row) => ({
      ...row,
      payloadJson: JSON.parse(row.payloadJson) as Record<string, unknown>,
    }));
  }
}
