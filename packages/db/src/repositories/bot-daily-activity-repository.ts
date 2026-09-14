import { and, gte, lte, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { botDailyActivity } from '../schema/bot-daily-activity';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;
type Row = typeof botDailyActivity.$inferSelect;

export interface DailyActivityRangeRow {
  botInstanceId: string;
  inboundCount: number;
  outboundCount: number;
}

export class BotDailyActivityRepository {
  constructor(private readonly db: Db) {}

  async incrementInbound(botInstanceId: string, date: string, updatedAt: Date = new Date()): Promise<void> {
    this.db.insert(botDailyActivity)
      .values({
        botInstanceId,
        date,
        inboundCount: 1,
        outboundCount: 0,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: [botDailyActivity.botInstanceId, botDailyActivity.date],
        set: {
          inboundCount: sql`${botDailyActivity.inboundCount} + 1`,
          updatedAt,
        },
      })
      .run();
  }

  async incrementOutbound(botInstanceId: string, date: string, updatedAt: Date = new Date()): Promise<void> {
    this.db.insert(botDailyActivity)
      .values({
        botInstanceId,
        date,
        inboundCount: 0,
        outboundCount: 1,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: [botDailyActivity.botInstanceId, botDailyActivity.date],
        set: {
          outboundCount: sql`${botDailyActivity.outboundCount} + 1`,
          updatedAt,
        },
      })
      .run();
  }

  async sumRange(fromDate: string, toDate: string): Promise<DailyActivityRangeRow[]> {
    const rows = this.db.select({
      botInstanceId: botDailyActivity.botInstanceId,
      inboundCount: sql<number>`sum(${botDailyActivity.inboundCount})`,
      outboundCount: sql<number>`sum(${botDailyActivity.outboundCount})`,
    })
      .from(botDailyActivity)
      .where(and(
        gte(botDailyActivity.date, fromDate),
        lte(botDailyActivity.date, toDate),
      ))
      .groupBy(botDailyActivity.botInstanceId)
      .all();
    return rows.map((row) => ({
      botInstanceId: row.botInstanceId,
      inboundCount: Number(row.inboundCount),
      outboundCount: Number(row.outboundCount),
    }));
  }
}
