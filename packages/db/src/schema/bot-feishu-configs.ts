import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { botInstances } from './bot-instances';
import { users } from './users';

export const FEISHU_EVENT_STATUSES = [
  'not_configured',
  'connecting',
  'connected',
  'error',
  'disabled',
] as const;

export const botFeishuConfigs = sqliteTable(
  'bot_feishu_configs',
  {
    botInstanceId: text('bot_instance_id')
      .primaryKey()
      .references(() => botInstances.id, { onDelete: 'cascade' }),
    appId: text('app_id').notNull().default(''),
    appSecret: text('app_secret').notNull().default(''),
    ownerOpenId: text('owner_open_id'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    eventStatus: text('event_status', { enum: FEISHU_EVENT_STATUSES })
      .notNull()
      .default('not_configured'),
    revision: integer('revision').notNull().default(1),
    observedRevision: integer('observed_revision'),
    lastConnectedAt: integer('last_connected_at', { mode: 'timestamp_ms' }),
    lastDisconnectedAt: integer('last_disconnected_at', { mode: 'timestamp_ms' }),
    lastInboundAt: integer('last_inbound_at', { mode: 'timestamp_ms' }),
    lastOutboundAt: integer('last_outbound_at', { mode: 'timestamp_ms' }),
    lastError: text('last_error'),
    updatedByUserId: text('updated_by_user_id')
      .references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    enabledIndex: index('bot_feishu_configs_enabled_idx').on(table.enabled),
  }),
);

export type FeishuEventStatus = (typeof FEISHU_EVENT_STATUSES)[number];
