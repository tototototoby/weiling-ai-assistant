import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { botInstances } from './bot-instances';

export const MEAL_REMINDER_STATUSES = ['unasked', 'prompted', 'enabled', 'disabled'] as const;

export const botMealReminderPreferences = sqliteTable('bot_meal_reminder_preferences', {
  botInstanceId: text('bot_instance_id')
    .primaryKey()
    .references(() => botInstances.id, { onDelete: 'cascade' }),
  status: text('status', { enum: MEAL_REMINDER_STATUSES }).notNull().default('unasked'),
  city: text('city').notNull().default('北京'),
  lastReminderDate: text('last_reminder_date'),
  lastReminderAt: integer('last_reminder_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export type MealReminderStatus = (typeof MEAL_REMINDER_STATUSES)[number];
