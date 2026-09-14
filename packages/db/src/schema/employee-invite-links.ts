import { desc } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const employeeInviteLinks = sqliteTable(
  'employee_invite_links',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    usageCount: integer('usage_count').notNull().default(0),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    createdAtIndex: index('employee_invite_links_created_at_idx').on(desc(table.createdAt), desc(table.id)),
    createdByUserIdIndex: index('employee_invite_links_created_by_idx').on(table.createdByUserId),
    tokenIndex: uniqueIndex('employee_invite_links_token_idx').on(table.token),
  }),
);
