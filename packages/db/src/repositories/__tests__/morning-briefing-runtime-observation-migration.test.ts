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

describe('0016_morning_briefing_runtime_observation migration', () => {
  it('adds neutral runtime observation fields without claiming a task exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weiling-briefing-runtime-migration-'));
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
      '../../migrations/0016_morning_briefing_runtime_observation.sql',
      import.meta.url,
    ));
    client.connection.exec(await readFile(migrationPath, 'utf8'));

    const row = client.connection.prepare(`
      SELECT
        runtime_schedule_task_id AS runtimeScheduleTaskId,
        runtime_scheduled_for AS runtimeScheduledFor,
        runtime_needs_schedule AS runtimeNeedsSchedule,
        runtime_needs_cleanup AS runtimeNeedsCleanup,
        runtime_observed_at AS runtimeObservedAt
      FROM bot_morning_briefing_policies
      WHERE bot_instance_id = 'bot_1'
    `).get();

    expect(row).toEqual({
      runtimeNeedsCleanup: 0,
      runtimeNeedsSchedule: 0,
      runtimeObservedAt: null,
      runtimeScheduledFor: null,
      runtimeScheduleTaskId: null,
    });
  });
});
