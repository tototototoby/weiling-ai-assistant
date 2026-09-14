import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabaseClient, migrateDatabase } from '../../client.js';
import { DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY } from '../../schema/global-admin-message-configs.js';

const tempDirs: string[] = [];
const clients: Array<ReturnType<typeof createDatabaseClient>> = [];

afterEach(async () => {
  clients.splice(0).forEach((client) => client.close());
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('0021_global_message_copy migration', () => {
  it('backfills the singleton with the v19 copy defaults and revision metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weiling-global-message-copy-'));
    tempDirs.push(dir);
    const client = createDatabaseClient({ url: `file:${join(dir, 'test.sqlite')}` });
    clients.push(client);
    migrateDatabase(client);

    const row = client.connection.prepare(`
      SELECT
        assistant_name AS assistantName,
        meal_consent_prompt AS mealConsentPrompt,
        meal_rain_reminder AS mealRainReminder,
        meal_standard_reminder AS mealStandardReminder,
        morning_briefing_intro AS morningBriefingIntro,
        processing_ack AS processingAck,
        wecom_ack AS wecomAck,
        wecom_duplicate AS wecomDuplicate,
        wecom_completed AS wecomCompleted,
        wecom_failure AS wecomFailure,
        wecom_unsupported AS wecomUnsupported,
        wecom_group_unsupported AS wecomGroupUnsupported,
        wecom_unbound AS wecomUnbound,
        wecom_binding_name_prompt AS wecomBindingNamePrompt,
        wecom_binding_name_invalid AS wecomBindingNameInvalid,
        wecom_binding_success AS wecomBindingSuccess,
        revision,
        observed_revision AS observedRevision,
        updated_by_user_id AS updatedByUserId
      FROM global_admin_message_configs
      WHERE id = 'global'
    `).get();
    const columns = client.connection.prepare(
      'PRAGMA table_info(global_admin_message_configs)',
    ).all() as Array<{ dflt_value: string | null; name: string; notnull: number }>;
    const journalPath = fileURLToPath(new URL('../../migrations/meta/_journal.json', import.meta.url));
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
      entries: Array<{ tag: string }>;
    };

    expect(row).toEqual({
      ...DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY,
      observedRevision: null,
      revision: 3,
      updatedByUserId: null,
    });
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'assistant_name',
      'meal_consent_prompt',
      'morning_briefing_intro',
      'processing_ack',
      'wecom_ack',
      'wecom_unbound',
      'wecom_binding_success',
      'revision',
      'observed_revision',
      'updated_by_user_id',
    ]));
    expect(columns.find((column) => column.name === 'assistant_name')).toMatchObject({
      dflt_value: "'微Link · 微灵 AI 助手'",
      notnull: 1,
    });
    expect(columns.find((column) => column.name === 'revision')).toMatchObject({
      dflt_value: '1',
      notnull: 1,
    });
    expect(journal.entries.some((entry) => entry.tag === '0021_global_message_copy')).toBe(true);
  });
});
