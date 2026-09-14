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
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('0020_bot_wecom_bindings migration', () => {
  it('moves valid employee bindings to Bots and rebuilds both Bot-owned ledgers', async () => {
    const client = await createLegacyClient();
    seedLegacyData(client);
    const migrationPath = fileURLToPath(new URL(
      '../../migrations/0020_bot_wecom_bindings.sql',
      import.meta.url,
    ));

    client.connection.exec(await readFile(migrationPath, 'utf8'));

    const tables = client.connection.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all().map((row) => (row as { name: string }).name);
    const binding = client.connection.prepare(`
      SELECT
        bot_instance_id AS botInstanceId,
        employee_id AS employeeId,
        wecom_user_id AS wecomUserId,
        enabled,
        preferred_for_proactive AS preferredForProactive,
        last_inbound_at AS lastInboundAt,
        last_error AS lastError,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM bot_wecom_bindings
    `).get();

    expect(tables).toContain('bot_wecom_bindings');
    expect(tables).not.toContain('employee_wecom_bindings');
    expect(binding).toEqual({
      botInstanceId: 'bot_1',
      createdAt: 10,
      employeeId: 'employee_1',
      enabled: 1,
      lastError: 'old warning',
      lastInboundAt: 11,
      preferredForProactive: 0,
      updatedAt: 12,
      wecomUserId: 'wecom-user-1',
    });
    expect(getColumnNames(client, 'wecom_message_receipts')).not.toContain('employee_id');
    expect(getColumnNames(client, 'wecom_proactive_deliveries')).not.toContain('employee_id');
    expect(client.connection.prepare(
      'SELECT message_id AS messageId, bot_instance_id AS botInstanceId FROM wecom_message_receipts',
    ).all()).toEqual([{ botInstanceId: 'bot_1', messageId: 'message_1' }]);
    expect(client.connection.prepare(`
      SELECT delivery_id AS deliveryId, bot_instance_id AS botInstanceId
      FROM wecom_proactive_deliveries
    `).all()).toEqual([{ botInstanceId: 'bot_1', deliveryId: 'delivery_1' }]);
  });

  it('sets employee metadata to null and cascades all channel state with Bot deletion', async () => {
    const client = await createLegacyClient();
    seedLegacyData(client);
    const migrationPath = fileURLToPath(new URL(
      '../../migrations/0020_bot_wecom_bindings.sql',
      import.meta.url,
    ));
    client.connection.exec(await readFile(migrationPath, 'utf8'));

    client.connection.prepare("DELETE FROM employee_directory_entries WHERE id = 'employee_1'").run();
    expect(client.connection.prepare(`
      SELECT employee_id AS employeeId FROM bot_wecom_bindings WHERE bot_instance_id = 'bot_1'
    `).get()).toEqual({ employeeId: null });
    expect(client.connection.prepare('SELECT COUNT(*) AS count FROM wecom_message_receipts').get())
      .toEqual({ count: 1 });
    expect(client.connection.prepare('SELECT COUNT(*) AS count FROM wecom_proactive_deliveries').get())
      .toEqual({ count: 1 });

    client.connection.prepare("DELETE FROM bot_instances WHERE id = 'bot_1'").run();
    expect(client.connection.prepare('SELECT COUNT(*) AS count FROM bot_wecom_bindings').get())
      .toEqual({ count: 0 });
    expect(client.connection.prepare('SELECT COUNT(*) AS count FROM wecom_message_receipts').get())
      .toEqual({ count: 0 });
    expect(client.connection.prepare('SELECT COUNT(*) AS count FROM wecom_proactive_deliveries').get())
      .toEqual({ count: 0 });
  });

  it('journals the migration and enforces one Bot per unique WeCom user', async () => {
    const client = await createLegacyClient();
    seedLegacyData(client);
    const migrationPath = fileURLToPath(new URL(
      '../../migrations/0020_bot_wecom_bindings.sql',
      import.meta.url,
    ));
    client.connection.exec(await readFile(migrationPath, 'utf8'));
    const journalPath = fileURLToPath(new URL('../../migrations/meta/_journal.json', import.meta.url));
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
      entries: Array<{ tag: string }>;
    };

    expect(journal.entries.some((entry) => entry.tag === '0020_bot_wecom_bindings')).toBe(true);
    expect(() => client.connection.prepare(`
      INSERT INTO bot_wecom_bindings (
        bot_instance_id, wecom_user_id, created_at, updated_at
      ) VALUES ('bot_2', 'wecom-user-1', 20, 20)
    `).run()).toThrow();
  });
});

async function createLegacyClient() {
  const dir = await mkdtemp(join(tmpdir(), 'weiling-bot-wecom-migration-'));
  tempDirs.push(dir);
  const client = createDatabaseClient({ url: `file:${join(dir, 'test.sqlite')}` });
  clients.push(client);
  client.connection.exec(`
    CREATE TABLE bot_instances (
      id text PRIMARY KEY NOT NULL
    );
    CREATE TABLE employee_directory_entries (
      id text PRIMARY KEY NOT NULL,
      claimed_bot_instance_id text
    );
    CREATE TABLE employee_wecom_bindings (
      employee_id text PRIMARY KEY NOT NULL,
      wecom_user_id text NOT NULL,
      enabled integer DEFAULT true NOT NULL,
      preferred_for_proactive integer DEFAULT true NOT NULL,
      last_inbound_at integer,
      last_outbound_at integer,
      last_error text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (employee_id) REFERENCES employee_directory_entries(id) ON DELETE cascade
    );
    CREATE UNIQUE INDEX employee_wecom_bindings_user_id_idx
      ON employee_wecom_bindings (wecom_user_id);
    CREATE INDEX employee_wecom_bindings_enabled_idx
      ON employee_wecom_bindings (enabled);
    CREATE TABLE wecom_message_receipts (
      message_id text PRIMARY KEY NOT NULL,
      employee_id text NOT NULL,
      bot_instance_id text NOT NULL,
      status text DEFAULT 'processing' NOT NULL,
      error text,
      attempt_count integer DEFAULT 0 NOT NULL,
      received_at integer NOT NULL,
      completed_at integer,
      updated_at integer NOT NULL,
      FOREIGN KEY (employee_id) REFERENCES employee_directory_entries(id) ON DELETE cascade
    );
    CREATE INDEX wecom_message_receipts_bot_received_idx
      ON wecom_message_receipts (bot_instance_id, received_at);
    CREATE TABLE wecom_proactive_deliveries (
      delivery_id text PRIMARY KEY NOT NULL,
      semantic_key text NOT NULL,
      employee_id text NOT NULL,
      bot_instance_id text NOT NULL,
      status text DEFAULT 'delivering' NOT NULL,
      attempt_count integer DEFAULT 0 NOT NULL,
      last_error text,
      sent_at integer,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (employee_id) REFERENCES employee_directory_entries(id) ON DELETE cascade
    );
    CREATE UNIQUE INDEX wecom_proactive_deliveries_semantic_key_idx
      ON wecom_proactive_deliveries (semantic_key);
    CREATE INDEX wecom_proactive_deliveries_status_updated_idx
      ON wecom_proactive_deliveries (status, updated_at);
    CREATE INDEX wecom_proactive_deliveries_bot_created_idx
      ON wecom_proactive_deliveries (bot_instance_id, created_at);
  `);
  return client;
}

function seedLegacyData(client: ReturnType<typeof createDatabaseClient>) {
  client.connection.exec(`
    INSERT INTO bot_instances (id) VALUES ('bot_1'), ('bot_2');
    INSERT INTO employee_directory_entries (id, claimed_bot_instance_id)
      VALUES ('employee_1', 'bot_1'), ('employee_2', NULL);
    INSERT INTO employee_wecom_bindings (
      employee_id, wecom_user_id, enabled, preferred_for_proactive,
      last_inbound_at, last_error, created_at, updated_at
    ) VALUES
      ('employee_1', 'wecom-user-1', 1, 0, 11, 'old warning', 10, 12),
      ('employee_2', 'wecom-user-2', 1, 1, NULL, NULL, 10, 12);
    INSERT INTO wecom_message_receipts (
      message_id, employee_id, bot_instance_id, attempt_count, received_at, updated_at
    ) VALUES
      ('message_1', 'employee_1', 'bot_1', 1, 20, 20),
      ('orphan_message', 'employee_2', 'missing_bot', 1, 20, 20);
    INSERT INTO wecom_proactive_deliveries (
      delivery_id, semantic_key, employee_id, bot_instance_id, attempt_count, created_at, updated_at
    ) VALUES
      ('delivery_1', 'semantic_1', 'employee_1', 'bot_1', 1, 30, 30),
      ('orphan_delivery', 'orphan_semantic', 'employee_2', 'missing_bot', 1, 30, 30);
  `);
}

function getColumnNames(
  client: ReturnType<typeof createDatabaseClient>,
  tableName: string,
): string[] {
  return client.connection.prepare(`PRAGMA table_info(${tableName})`).all()
    .map((row) => (row as { name: string }).name);
}
