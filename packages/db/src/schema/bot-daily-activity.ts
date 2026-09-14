import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { botInstances } from './bot-instances';

export const botDailyActivity = sqliteTable(
  'bot_daily_activity',
  {
    botInstanceId: text('bot_instance_id')
      .notNull()
      .references(() => botInstances.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    inboundCount: integer('inbound_count').notNull().default(0),
    outboundCount: integer('outbound_count').notNull().default(0),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.botInstanceId, table.date] }),
  }),
);
