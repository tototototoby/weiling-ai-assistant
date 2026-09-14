import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabaseClient } from '../../client.js';

const tempDirs: string[] = [];
const clients: Array<ReturnType<typeof createDatabaseClient>> = [];

afterEach(async () => {
  clients.splice(0).forEach((client) => client.close());
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('0015_bot_sandbox_runtime_pools migration', () => {
  it('backfills one isolated pool per Bot from its owner pool policy', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-bot-srt-migration-'));
    tempDirs.push(dir);
    const client = createDatabaseClient({ url: `file:${join(dir, 'test.sqlite')}` });
    clients.push(client);

    createLegacyTables(client.connection);
    seedLegacyPools(client.connection);

    const migrationPath = fileURLToPath(new URL(
      '../../migrations/0015_bot_sandbox_runtime_pools.sql',
      import.meta.url,
    ));
    client.connection.exec(await readFile(migrationPath, 'utf8'));

    const rows = client.connection.prepare(`
      SELECT
        bot_instance_id AS botInstanceId,
        enabled,
        port,
        api_key AS apiKey,
        workspace_base_path AS workspaceBasePath,
        pool_size AS poolSize,
        min_ready_processes AS minReadyProcesses,
        session_timeout_ms AS sessionTimeoutMs,
        health_check_interval_ms AS healthCheckIntervalMs,
        port_range_start AS portRangeStart,
        port_range_end AS portRangeEnd,
        default_deny_read_json AS defaultDenyReadJson
      FROM bot_sandbox_runtime_pools
      ORDER BY bot_instance_id
    `).all() as Array<{
      apiKey: string;
      botInstanceId: string;
      defaultDenyReadJson: string;
      enabled: number;
      healthCheckIntervalMs: number;
      minReadyProcesses: number;
      poolSize: number;
      port: number;
      portRangeEnd: number;
      portRangeStart: number;
      sessionTimeoutMs: number;
      workspaceBasePath: string;
    }>;

    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      botInstanceId: 'bot_1',
      defaultDenyReadJson: '["/owner-one"]',
      enabled: 1,
      healthCheckIntervalMs: 60_000,
      minReadyProcesses: 1,
      poolSize: 1,
      port: 32_000,
      portRangeEnd: 10_049,
      portRangeStart: 10_000,
      sessionTimeoutMs: 600_000,
      workspaceBasePath: '/custom/srt-root/bot_1',
    });
    expect(rows[1]).toMatchObject({
      botInstanceId: 'bot_2',
      defaultDenyReadJson: '["/owner-one"]',
      port: 32_001,
      portRangeEnd: 10_099,
      portRangeStart: 10_050,
      workspaceBasePath: '/custom/srt-root/bot_2',
    });
    expect(rows[2]).toMatchObject({
      botInstanceId: 'bot_3',
      defaultDenyReadJson: '["/owner-two"]',
      enabled: 0,
      healthCheckIntervalMs: 30_000,
      port: 32_002,
      portRangeEnd: 10_179,
      portRangeStart: 10_100,
      sessionTimeoutMs: 300_000,
      workspaceBasePath: '/app/apps/sandbox-runtime/user-workspaces/bot_3',
    });
    expect(rows[3]).toMatchObject({
      botInstanceId: 'bot_4',
      defaultDenyReadJson: expect.stringContaining('/etc/passwd'),
      enabled: 1,
      healthCheckIntervalMs: 60_000,
      minReadyProcesses: 1,
      poolSize: 1,
      port: 32_003,
      portRangeEnd: 10_279,
      portRangeStart: 10_180,
      sessionTimeoutMs: 600_000,
      workspaceBasePath: '/app/apps/sandbox-runtime/user-workspaces/bot_4',
    });
    expect(new Set(rows.map((row) => row.apiKey)).size).toBe(4);
    expect(rows.every((row) => row.apiKey.length === 64)).toBe(true);

    const legacyCount = client.connection
      .prepare('SELECT COUNT(*) AS count FROM user_sandbox_runtime_pools')
      .get() as { count: number };
    expect(legacyCount.count).toBe(2);
  });
});

function createLegacyTables(connection: ReturnType<typeof createDatabaseClient>['connection']) {
  connection.exec(`
    CREATE TABLE bot_instances (
      id text PRIMARY KEY NOT NULL,
      owner_user_id text NOT NULL,
      created_at integer NOT NULL
    );

    CREATE TABLE user_sandbox_runtime_pools (
      id text PRIMARY KEY NOT NULL,
      owner_user_id text NOT NULL,
      enabled integer DEFAULT true NOT NULL,
      port integer NOT NULL,
      api_key text NOT NULL,
      workspace_base_path text NOT NULL,
      pool_size integer NOT NULL,
      min_ready_processes integer NOT NULL,
      session_timeout_ms integer NOT NULL,
      max_concurrent_init integer NOT NULL,
      health_check_interval_ms integer NOT NULL,
      port_range_start integer NOT NULL,
      port_range_end integer NOT NULL,
      default_denied_domains_json text NOT NULL,
      default_allow_read_json text NOT NULL,
      default_allow_write_json text NOT NULL,
      default_deny_read_json text NOT NULL,
      default_deny_write_json text NOT NULL,
      restart_requested_at integer,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );
  `);
}

function seedLegacyPools(connection: ReturnType<typeof createDatabaseClient>['connection']) {
  const insertBot = connection.prepare(`
    INSERT INTO bot_instances (id, owner_user_id, created_at)
    VALUES (@id, @ownerUserId, @createdAt)
  `);
  insertBot.run({ createdAt: 1, id: 'bot_1', ownerUserId: 'user_1' });
  insertBot.run({ createdAt: 2, id: 'bot_2', ownerUserId: 'user_1' });
  insertBot.run({ createdAt: 3, id: 'bot_3', ownerUserId: 'user_2' });
  insertBot.run({ createdAt: 4, id: 'bot_4', ownerUserId: 'user_3' });

  const insertPool = connection.prepare(`
    INSERT INTO user_sandbox_runtime_pools (
      id,
      owner_user_id,
      enabled,
      port,
      api_key,
      workspace_base_path,
      pool_size,
      min_ready_processes,
      session_timeout_ms,
      max_concurrent_init,
      health_check_interval_ms,
      port_range_start,
      port_range_end,
      default_denied_domains_json,
      default_allow_read_json,
      default_allow_write_json,
      default_deny_read_json,
      default_deny_write_json,
      restart_requested_at,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @ownerUserId,
      @enabled,
      @port,
      @apiKey,
      @workspaceBasePath,
      @poolSize,
      @minReadyProcesses,
      @sessionTimeoutMs,
      @maxConcurrentInit,
      @healthCheckIntervalMs,
      @portRangeStart,
      @portRangeEnd,
      '[]',
      '[]',
      '[]',
      @defaultDenyReadJson,
      '[]',
      NULL,
      10,
      20
    )
  `);

  insertPool.run({
    apiKey: 'legacy-1',
    defaultDenyReadJson: '["/owner-one"]',
    enabled: 1,
    healthCheckIntervalMs: 60_000,
    id: 'pool_1',
    maxConcurrentInit: 1,
    minReadyProcesses: 2,
    ownerUserId: 'user_1',
    poolSize: 3,
    port: 32_000,
    portRangeEnd: 10_049,
    portRangeStart: 10_000,
    sessionTimeoutMs: 600_000,
    workspaceBasePath: '/custom/srt-root/user_1',
  });
  insertPool.run({
    apiKey: 'legacy-2',
    defaultDenyReadJson: '["/owner-two"]',
    enabled: 0,
    healthCheckIntervalMs: 30_000,
    id: 'pool_2',
    maxConcurrentInit: 1,
    minReadyProcesses: 1,
    ownerUserId: 'user_2',
    poolSize: 2,
    port: 32_010,
    portRangeEnd: 20_079,
    portRangeStart: 20_000,
    sessionTimeoutMs: 300_000,
    workspaceBasePath: '/unexpected-layout',
  });
}
