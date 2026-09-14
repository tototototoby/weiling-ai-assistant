import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const deliveryHealthChecks = sqliteTable(
  'delivery_health_checks',
  {
    id: text('id').primaryKey(),
    checkDate: text('check_date').notNull(),
    summaryJson: text('summary_json').notNull().default('{}'),
    alertSent: integer('alert_sent', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    dateIndex: uniqueIndex('delivery_health_checks_date_idx').on(table.checkDate),
    createdAtIndex: index('delivery_health_checks_created_idx').on(table.createdAt),
  }),
);
