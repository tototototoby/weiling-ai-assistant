import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { botInstances } from './bot-instances';

export const botSandboxRuntimePools = sqliteTable(
  'bot_sandbox_runtime_pools',
  {
    id: text('id').primaryKey(),
    botInstanceId: text('bot_instance_id')
      .notNull()
      .references(() => botInstances.id, { onDelete: 'cascade' }),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    port: integer('port').notNull(),
    apiKey: text('api_key').notNull(),
    workspaceBasePath: text('workspace_base_path').notNull(),
    poolSize: integer('pool_size').notNull(),
    minReadyProcesses: integer('min_ready_processes').notNull(),
    sessionTimeoutMs: integer('session_timeout_ms').notNull(),
    maxConcurrentInit: integer('max_concurrent_init').notNull(),
    healthCheckIntervalMs: integer('health_check_interval_ms').notNull(),
    portRangeStart: integer('port_range_start').notNull(),
    portRangeEnd: integer('port_range_end').notNull(),
    defaultDeniedDomainsJson: text('default_denied_domains_json').notNull(),
    defaultAllowReadJson: text('default_allow_read_json').notNull(),
    defaultAllowWriteJson: text('default_allow_write_json').notNull(),
    defaultDenyReadJson: text('default_deny_read_json').notNull(),
    defaultDenyWriteJson: text('default_deny_write_json').notNull(),
    restartRequestedAt: integer('restart_requested_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    apiKeyIndex: uniqueIndex('bot_srt_pools_api_key_idx').on(table.apiKey),
    botInstanceIndex: uniqueIndex('bot_srt_pools_bot_instance_idx').on(table.botInstanceId),
    portIndex: uniqueIndex('bot_srt_pools_port_idx').on(table.port),
  }),
);
