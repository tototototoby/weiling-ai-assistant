import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { botInstances } from './bot-instances';
import { employeeDirectoryEntries } from './employee-directory-entries';

export const botWecomBindings = sqliteTable(
  'bot_wecom_bindings',
  {
    botInstanceId: text('bot_instance_id')
      .primaryKey()
      .references(() => botInstances.id, { onDelete: 'cascade' }),
    employeeId: text('employee_id')
      .references(() => employeeDirectoryEntries.id, { onDelete: 'set null' }),
    wecomUserId: text('wecom_user_id').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    preferredForProactive: integer('preferred_for_proactive', { mode: 'boolean' })
      .notNull()
      .default(true),
    lastInboundAt: integer('last_inbound_at', { mode: 'timestamp_ms' }),
    lastOutboundAt: integer('last_outbound_at', { mode: 'timestamp_ms' }),
    lastError: text('last_error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    enabledIndex: index('bot_wecom_bindings_enabled_idx').on(table.enabled),
    employeeIndex: index('bot_wecom_bindings_employee_idx').on(table.employeeId),
    wecomUserIdIndex: uniqueIndex('bot_wecom_bindings_user_id_idx').on(table.wecomUserId),
  }),
);
