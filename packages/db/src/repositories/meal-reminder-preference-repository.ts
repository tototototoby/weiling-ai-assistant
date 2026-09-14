import { asc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { botInstances } from '../schema/bot-instances';
import {
  botMealReminderPreferences,
  type MealReminderStatus,
} from '../schema/bot-meal-reminder-preferences';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;

export interface MealReminderPreferenceRecord {
  botInstanceId: string;
  city: string;
  createdAt: Date;
  lastReminderAt: Date | null;
  lastReminderDate: string | null;
  status: MealReminderStatus;
  updatedAt: Date;
}

export class MealReminderPreferenceRepository {
  constructor(private readonly db: Db) {}

  async ensureForAllBots(createdAt: Date = new Date()): Promise<MealReminderPreferenceRecord[]> {
    const bots = this.db.select({ id: botInstances.id }).from(botInstances).all();
    if (bots.length > 0) {
      this.db.insert(botMealReminderPreferences)
        .values(bots.map(({ id }) => ({ botInstanceId: id, createdAt, updatedAt: createdAt })))
        .onConflictDoNothing({ target: botMealReminderPreferences.botInstanceId })
        .run();
    }
    return this.listAll();
  }

  async listAll(): Promise<MealReminderPreferenceRecord[]> {
    return this.db.select().from(botMealReminderPreferences)
      .orderBy(asc(botMealReminderPreferences.createdAt), asc(botMealReminderPreferences.botInstanceId))
      .all();
  }

  async listEnabled(): Promise<MealReminderPreferenceRecord[]> {
    return this.db.select().from(botMealReminderPreferences)
      .where(eq(botMealReminderPreferences.status, 'enabled'))
      .orderBy(asc(botMealReminderPreferences.createdAt), asc(botMealReminderPreferences.botInstanceId))
      .all();
  }

  async listUnasked(): Promise<MealReminderPreferenceRecord[]> {
    return this.db.select().from(botMealReminderPreferences)
      .where(eq(botMealReminderPreferences.status, 'unasked'))
      .orderBy(asc(botMealReminderPreferences.createdAt), asc(botMealReminderPreferences.botInstanceId))
      .all();
  }

  async setStatus(
    botInstanceId: string,
    status: Exclude<MealReminderStatus, 'unasked'>,
    updatedAt: Date = new Date(),
  ): Promise<void> {
    this.db.insert(botMealReminderPreferences)
      .values({ botInstanceId, createdAt: updatedAt, status, updatedAt })
      .onConflictDoUpdate({
        target: botMealReminderPreferences.botInstanceId,
        set: { status, updatedAt },
      })
      .run();
  }

  async markReminded(
    botInstanceId: string,
    reminderDate: string,
    remindedAt: Date = new Date(),
  ): Promise<void> {
    this.db.update(botMealReminderPreferences)
      .set({ lastReminderAt: remindedAt, lastReminderDate: reminderDate, updatedAt: remindedAt })
      .where(eq(botMealReminderPreferences.botInstanceId, botInstanceId))
      .run();
  }
}
