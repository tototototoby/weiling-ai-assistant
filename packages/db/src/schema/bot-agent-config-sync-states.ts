import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { botInstances } from './bot-instances';

export const AGENT_CONFIG_SYNC_STATUSES = ['pending', 'synced', 'error'] as const;

export const botAgentConfigSyncStates = sqliteTable('bot_agent_config_sync_states', {
  botInstanceId: text('bot_instance_id')
    .primaryKey()
    .references(() => botInstances.id, { onDelete: 'cascade' }),
  appliedRevision: integer('applied_revision').notNull().default(0),
  appliedOverrideRevision: integer('applied_override_revision').notNull().default(0),
  syncStatus: text('sync_status', { enum: AGENT_CONFIG_SYNC_STATUSES })
    .notNull()
    .default('pending'),
  lastSyncError: text('last_sync_error'),
  lastSyncedAt: integer('last_synced_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export type AgentConfigSyncStatus = (typeof AGENT_CONFIG_SYNC_STATUSES)[number];
