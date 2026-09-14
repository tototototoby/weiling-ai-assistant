import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { botFeishuGroupSessions } from '../schema/bot-feishu-group-sessions';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;

export class BotFeishuGroupSessionRepository {
  constructor(private readonly db: Db) {}

  async find(
    botInstanceId: string,
    chatId: string,
  ): Promise<{ sessionId: string } | null> {
    const row = this.db.select()
      .from(botFeishuGroupSessions)
      .where(and(
        eq(botFeishuGroupSessions.botInstanceId, botInstanceId),
        eq(botFeishuGroupSessions.chatId, chatId),
      ))
      .get();
    return row ? { sessionId: row.sessionId } : null;
  }

  async upsert(
    botInstanceId: string,
    chatId: string,
    sessionId: string,
    updatedAt: Date = new Date(),
  ): Promise<void> {
    this.db.insert(botFeishuGroupSessions)
      .values({
        botInstanceId,
        chatId,
        createdAt: updatedAt,
        sessionId,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: [botFeishuGroupSessions.botInstanceId, botFeishuGroupSessions.chatId],
        set: {
          sessionId,
          updatedAt,
        },
      })
      .run();
  }
}
