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

describe('0017_central_morning_briefing_delivery migration', () => {
  it('adds neutral central delivery state to existing policies', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weiling-central-briefing-migration-'));
    tempDirs.push(dir);
    const client = createDatabaseClient({ url: `file:${join(dir, 'test.sqlite')}` });
    clients.push(client);

    client.connection.exec(`
      CREATE TABLE bot_morning_briefing_policies (
        bot_instance_id text PRIMARY KEY NOT NULL,
        admin_enabled integer DEFAULT true NOT NULL
      );
      INSERT INTO bot_morning_briefing_policies (bot_instance_id) VALUES ('bot_1');
    `);

    const migrationPath = fileURLToPath(new URL(
      '../../migrations/0017_central_morning_briefing_delivery.sql',
      import.meta.url,
    ));
    client.connection.exec(await readFile(migrationPath, 'utf8'));

    const row = client.connection.prepare(`
      SELECT
        central_scheduled_for AS centralScheduledFor,
        central_last_delivery_date AS centralLastDeliveryDate,
        central_last_delivered_at AS centralLastDeliveredAt,
        central_last_error AS centralLastError
      FROM bot_morning_briefing_policies
      WHERE bot_instance_id = 'bot_1'
    `).get();

    expect(row).toEqual({
      centralLastDeliveredAt: null,
      centralLastDeliveryDate: null,
      centralLastError: null,
      centralScheduledFor: null,
    });
  });
});
