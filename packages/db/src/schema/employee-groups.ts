import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const employeeGroups = sqliteTable(
  'employee_groups',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    leaderEmployeeId: text('leader_employee_id'),
    createdByUserId: text('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    nameIndex: uniqueIndex('employee_groups_name_idx').on(table.name),
    leaderIndex: index('employee_groups_leader_idx').on(table.leaderEmployeeId),
  }),
);
