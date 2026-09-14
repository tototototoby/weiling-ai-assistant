import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const GLOBAL_WECOM_CONFIG_ID = 'global';
export const WECOM_CONNECTION_STATUSES = [
  'disabled',
  'connecting',
  'connected',
  'error',
] as const;

export const globalWecomConfigs = sqliteTable('global_wecom_configs', {
  id: text('id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  botId: text('bot_id').notNull().default(''),
  secret: text('secret').notNull().default(''),
  wsUrl: text('ws_url').notNull().default('wss://openws.work.weixin.qq.com'),
  revision: integer('revision').notNull().default(1),
  connectionStatus: text('connection_status', { enum: WECOM_CONNECTION_STATUSES })
    .notNull()
    .default('disabled'),
  observedRevision: integer('observed_revision'),
  lastConnectedAt: integer('last_connected_at', { mode: 'timestamp_ms' }),
  lastDisconnectedAt: integer('last_disconnected_at', { mode: 'timestamp_ms' }),
  lastError: text('last_error'),
  updatedByUserId: text('updated_by_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export type WecomConnectionStatus = (typeof WECOM_CONNECTION_STATUSES)[number];
