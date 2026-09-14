import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { botInstances } from './bot-instances';

export const DIFY_SYNC_STATUSES = ['pending', 'synced', 'error'] as const;

export const botDifySyncStates = sqliteTable('bot_dify_sync_states', {
  botInstanceId: text('bot_instance_id')
    .primaryKey()
    .references(() => botInstances.id, { onDelete: 'cascade' }),
  appliedRevision: integer('applied_revision').notNull().default(0),
  syncStatus: text('sync_status', { enum: DIFY_SYNC_STATUSES }).notNull().default('pending'),
  lastSyncError: text('last_sync_error'),
  lastSyncedAt: integer('last_synced_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export type DifySyncStatus = (typeof DIFY_SYNC_STATUSES)[number];
