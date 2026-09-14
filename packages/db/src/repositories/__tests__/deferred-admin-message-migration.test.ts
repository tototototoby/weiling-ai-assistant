import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabaseClient, migrateDatabase } from '../../client.js';

const tempDirs: string[] = [];
const clients: Array<ReturnType<typeof createDatabaseClient>> = [];

afterEach(async () => {
  clients.splice(0).forEach((client) => client.close());
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('0019_deferred_admin_messages migration', () => {
  it('creates the global switch and waiting queue index with deferred delivery enabled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weiling-deferred-admin-message-'));
    tempDirs.push(dir);
    const client = createDatabaseClient({ url: `file:${join(dir, 'test.sqlite')}` });
    clients.push(client);
    migrateDatabase(client);

    const config = client.connection.prepare(`
      SELECT
        id,
        defer_failed_until_user_active AS deferFailedUntilUserActive
      FROM global_admin_message_configs
    `).get();
    const index = client.connection.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND name = 'admin_message_deliveries_waiting_bot_idx'
    `).get();
    const columns = client.connection.prepare(
      'PRAGMA table_info(global_admin_message_configs)',
    ).all() as Array<{ dflt_value: string | null; name: string; notnull: number; pk: number }>;
    const indexColumns = client.connection.prepare(
      'PRAGMA index_info(admin_message_deliveries_waiting_bot_idx)',
    ).all() as Array<{ name: string }>;
    const journalPath = fileURLToPath(new URL('../../migrations/meta/_journal.json', import.meta.url));
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
      entries: Array<{ tag: string }>;
    };

    expect(config).toEqual({ deferFailedUntilUserActive: 1, id: 'global' });
    expect(index).toEqual({ name: 'admin_message_deliveries_waiting_bot_idx' });
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'id',
      'defer_failed_until_user_active',
      'created_at',
      'updated_at',
    ]));
    expect(columns.find((column) => column.name === 'id')).toMatchObject({ notnull: 1, pk: 1 });
    expect(columns.find((column) => column.name === 'defer_failed_until_user_active'))
      .toMatchObject({ dflt_value: 'true', notnull: 1 });
    expect(indexColumns.map((column) => column.name)).toEqual([
      'status',
      'bot_instance_id',
      'created_at',
    ]);
    expect(journal.entries.some((entry) => entry.tag === '0019_deferred_admin_messages')).toBe(true);
  });
});
