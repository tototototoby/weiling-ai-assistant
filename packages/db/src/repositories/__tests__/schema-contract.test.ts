import { createHash } from 'node:crypto';
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
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function getColumnNames(
  connection: ReturnType<typeof createDatabaseClient>['connection'],
  tableName: string,
): string[] {
  return connection
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .map((row) => {
      const typedRow = row as { name: string };
      return typedRow.name;
    });
}

async function getCurrentMigrationHashes(): Promise<string[]> {
  const migrationsDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
  const journalPath = fileURLToPath(new URL('../../migrations/meta/_journal.json', import.meta.url));
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
    entries: Array<{ tag: string }>;
  };

  return Promise.all(
    journal.entries.map(async (entry) => {
      const sqlPath = join(migrationsDirectory, `${entry.tag}.sql`);
      const sql = await readFile(sqlPath, 'utf8');
      return createHash('sha256').update(sql).digest('hex');
    }),
  );
}

function getAppliedMigrationHashes(
  connection: ReturnType<typeof createDatabaseClient>['connection'],
): string[] {
  return connection
    .prepare('SELECT hash FROM __drizzle_migrations ORDER BY created_at ASC')
    .all()
    .map((row) => {
      const typedRow = row as { hash: string };
      return typedRow.hash;
    });
}

describe('database schema contract', () => {
  it('exports the llm profile schema and repository without exposing the legacy single-config repository', async () => {
    const dbExports = await import('../../index.js');

    expect(dbExports).toHaveProperty('UserLlmProfileRepository');
    expect(dbExports).toHaveProperty('userLlmProfiles');
    expect(dbExports).toHaveProperty('UserSandboxRuntimePoolRepository');
    expect(dbExports).toHaveProperty('userSandboxRuntimePools');
    expect(dbExports).toHaveProperty('BotSandboxRuntimePoolRepository');
    expect(dbExports).toHaveProperty('botSandboxRuntimePools');
    expect(dbExports).toHaveProperty('MorningBriefingPolicyRepository');
    expect(dbExports).toHaveProperty('botMorningBriefingPolicies');
    expect(dbExports).toHaveProperty('GlobalAgentConfigRepository');
    expect(dbExports).toHaveProperty('globalAgentConfigs');
    expect(dbExports).toHaveProperty('globalAgentSkillPolicies');
    expect(dbExports).toHaveProperty('BotAgentConfigSyncRepository');
    expect(dbExports).toHaveProperty('botAgentConfigSyncStates');
    expect(dbExports).toHaveProperty('botAgentConfigOverrides');
    expect(dbExports).toHaveProperty('botAgentConfigOverrideRevisions');
    expect(dbExports).toHaveProperty('EmployeeDirectoryRepository');
    expect(dbExports).toHaveProperty('employeeDirectoryEntries');
    expect(dbExports).toHaveProperty('EmployeeInviteLinkRepository');
    expect(dbExports).toHaveProperty('RegistrationOnboardingConfigRepository');
    expect(dbExports).toHaveProperty('GlobalRagflowConfigRepository');
    expect(dbExports).toHaveProperty('BotRagflowSyncRepository');
    expect(dbExports).toHaveProperty('globalRagflowConfigs');
    expect(dbExports).toHaveProperty('botRagflowSyncStates');
    expect(dbExports).toHaveProperty('GlobalWecomConfigRepository');
    expect(dbExports).toHaveProperty('globalWecomConfigs');
    expect(dbExports).toHaveProperty('BotWecomBindingRepository');
    expect(dbExports).toHaveProperty('botWecomBindings');
    expect(dbExports).toHaveProperty('WecomMessageReceiptRepository');
    expect(dbExports).toHaveProperty('wecomMessageReceipts');
    expect(dbExports).toHaveProperty('WecomProactiveDeliveryRepository');
    expect(dbExports).toHaveProperty('wecomProactiveDeliveries');
    expect(dbExports).toHaveProperty('WecomOnboardingRepository');
    expect(dbExports).toHaveProperty('wecomOnboardingReceipts');
    expect(dbExports).toHaveProperty('wecomOnboardingSessions');
    expect(dbExports).toHaveProperty('GlobalAdminMessageConfigRepository');
    expect(dbExports).toHaveProperty('globalAdminMessageConfigs');
    expect(dbExports).toHaveProperty('GlobalEmailConfigRepository');
    expect(dbExports).toHaveProperty('globalEmailConfigs');
    expect(dbExports).toHaveProperty('EmailDeliveryRepository');
    expect(dbExports).toHaveProperty('emailDeliveries');
    expect(dbExports).toHaveProperty('DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY');
    expect(dbExports.GLOBAL_ADMIN_MESSAGE_COPY_KEYS).toContain('wecomBindingSuccess');
    expect(dbExports.ADMIN_MESSAGE_DELIVERY_STATUSES).toContain('waiting_for_user');
    expect(dbExports).not.toHaveProperty('EmployeeWecomBindingRepository');
    expect(dbExports).not.toHaveProperty('employeeWecomBindings');
    expect(dbExports).not.toHaveProperty('UserLlmConfigRepository');
  });

  it('contains auth tables, invite tables, llm profile binding columns, srt pools, and restart marker columns after migration', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-db-schema-'));
    tempDirs.push(dir);

    const client = createDatabaseClient({
      url: `file:${join(dir, 'test.sqlite')}`,
    });
    clients.push(client);

    migrateDatabase(client);

    const tables = client.connection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => {
        const typedRow = row as { name: string };
        return typedRow.name;
      });

    const userColumns = getColumnNames(client.connection, 'users');
    const botInstanceColumns = getColumnNames(client.connection, 'bot_instances');
    const workspaceColumns = getColumnNames(client.connection, 'workspaces');
    const registrationBootstrapClaimColumns = getColumnNames(client.connection, 'registration_bootstrap_claims');
    const registrationInviteColumns = getColumnNames(client.connection, 'registration_invites');
    const userLlmProfileColumns = getColumnNames(client.connection, 'user_llm_profiles');
    const userSandboxRuntimePoolColumns = getColumnNames(client.connection, 'user_sandbox_runtime_pools');
    const botSandboxRuntimePoolColumns = getColumnNames(client.connection, 'bot_sandbox_runtime_pools');
    const morningBriefingPolicyColumns = getColumnNames(client.connection, 'bot_morning_briefing_policies');
    const globalAgentConfigColumns = getColumnNames(client.connection, 'global_agent_configs');
    const globalAgentSkillPolicyColumns = getColumnNames(client.connection, 'global_agent_skill_policies');
    const botAgentConfigSyncStateColumns = getColumnNames(client.connection, 'bot_agent_config_sync_states');
    const employeeDirectoryColumns = getColumnNames(client.connection, 'employee_directory_entries');
    const employeeInviteLinkColumns = getColumnNames(client.connection, 'employee_invite_links');
    const registrationOnboardingConfigColumns = getColumnNames(client.connection, 'registration_onboarding_configs');
    const globalRagflowConfigColumns = getColumnNames(client.connection, 'global_ragflow_configs');
    const botRagflowSyncStateColumns = getColumnNames(client.connection, 'bot_ragflow_sync_states');
    const globalAdminMessageConfigColumns = getColumnNames(
      client.connection,
      'global_admin_message_configs',
    );
    const globalEmailConfigColumns = getColumnNames(client.connection, 'global_email_configs');
    const emailDeliveryColumns = getColumnNames(client.connection, 'email_deliveries');
    const botWecomBindingColumns = getColumnNames(client.connection, 'bot_wecom_bindings');
    const wecomMessageReceiptColumns = getColumnNames(client.connection, 'wecom_message_receipts');
    const wecomProactiveDeliveryColumns = getColumnNames(
      client.connection,
      'wecom_proactive_deliveries',
    );
    const wecomOnboardingReceiptColumns = getColumnNames(
      client.connection,
      'wecom_onboarding_receipts',
    );
    const wecomOnboardingSessionColumns = getColumnNames(
      client.connection,
      'wecom_onboarding_sessions',
    );

    expect(tables).toEqual(
      expect.arrayContaining(['users', 'workspaces', 'bot_instances', 'bot_events']),
    );
    expect(tables).toEqual(
      expect.arrayContaining([
        'sessions',
        'accounts',
        'verifications',
        'registration_bootstrap_claims',
        'registration_invites',
        'user_llm_profiles',
        'user_sandbox_runtime_pools',
        'bot_sandbox_runtime_pools',
        'bot_morning_briefing_policies',
        'global_agent_configs',
        'global_agent_skill_policies',
        'bot_agent_config_sync_states',
        'bot_agent_config_overrides',
        'bot_agent_config_override_revisions',
        'employee_directory_entries',
        'employee_invite_links',
        'registration_onboarding_configs',
        'global_ragflow_configs',
        'bot_ragflow_sync_states',
        'global_admin_message_configs',
        'global_email_configs',
        'email_deliveries',
        'bot_wecom_bindings',
        'wecom_message_receipts',
        'wecom_proactive_deliveries',
        'wecom_onboarding_receipts',
        'wecom_onboarding_sessions',
      ]),
    );
    expect(tables).not.toContain('employee_wecom_bindings');
    expect(tables).not.toContain('user_llm_configs');
    expect(userColumns).toEqual(
      expect.arrayContaining(['id', 'email', 'name', 'email_verified', 'image']),
    );
    expect(userColumns).not.toContain('password_hash');
    expect(botInstanceColumns).toContain('restart_requested_at');
    expect(botInstanceColumns).toContain('llm_config_id');
    expect(botInstanceColumns).not.toEqual(
      expect.arrayContaining([
        'fastagent_binary_path',
        'data_dir',
        'workspace_dir',
        'log_dir',
      ]),
    );
    expect(workspaceColumns).not.toContain('filesystem_path');
    expect(registrationBootstrapClaimColumns).toEqual(
      expect.arrayContaining(['claim_token', 'claimed_at', 'claimed_by_email']),
    );
    expect(registrationInviteColumns).toEqual(
      expect.arrayContaining(['reservation_token', 'reserved_at', 'reserved_by_email']),
    );
    expect(userLlmProfileColumns).toEqual(
      expect.arrayContaining(['id', 'user_id', 'name', 'provider', 'model', 'api_key', 'base_url', 'api_type']),
    );
    expect(userSandboxRuntimePoolColumns).toEqual(
      expect.arrayContaining([
        'id',
        'owner_user_id',
        'enabled',
        'port',
        'api_key',
        'workspace_base_path',
        'pool_size',
        'min_ready_processes',
        'session_timeout_ms',
        'max_concurrent_init',
        'health_check_interval_ms',
        'port_range_start',
        'port_range_end',
        'restart_requested_at',
      ]),
    );
    expect(botSandboxRuntimePoolColumns).toEqual(
      expect.arrayContaining([
        'id',
        'bot_instance_id',
        'enabled',
        'port',
        'api_key',
        'workspace_base_path',
        'pool_size',
        'min_ready_processes',
        'session_timeout_ms',
        'max_concurrent_init',
        'health_check_interval_ms',
        'port_range_start',
        'port_range_end',
        'restart_requested_at',
      ]),
    );
    expect(morningBriefingPolicyColumns).toEqual(
      expect.arrayContaining([
        'bot_instance_id',
        'admin_enabled',
        'location',
        'delivery_time',
        'timezone',
        'force_enabled',
        'observed_user_opt_out',
        'desired_revision',
        'applied_revision',
        'sync_status',
        'last_sync_error',
        'last_synced_at',
        'created_at',
        'updated_at',
      ]),
    );
    expect(globalAgentConfigColumns).toEqual(
      expect.arrayContaining([
        'id',
        'agents_markdown',
        'soul_markdown',
        'revision',
        'created_at',
        'updated_at',
      ]),
    );
    expect(globalAgentSkillPolicyColumns).toEqual(
      expect.arrayContaining(['skill_name', 'enabled', 'created_at', 'updated_at']),
    );
    expect(botAgentConfigSyncStateColumns).toEqual(
      expect.arrayContaining([
        'bot_instance_id',
        'applied_revision',
        'applied_override_revision',
        'sync_status',
        'last_sync_error',
        'last_synced_at',
        'created_at',
        'updated_at',
      ]),
    );
    expect(employeeDirectoryColumns).toEqual(expect.arrayContaining([
      'legal_name',
      'nickname',
      'company_email',
      'enabled',
      'reservation_token',
      'claimed_by_user_id',
      'claimed_at',
    ]));
    expect(employeeInviteLinkColumns).toEqual(expect.arrayContaining([
      'token',
      'enabled',
      'usage_count',
      'created_by_user_id',
    ]));
    expect(registrationOnboardingConfigColumns).toContain('default_llm_profile_id');
    expect(globalRagflowConfigColumns).toEqual(expect.arrayContaining([
      'api_base_url',
      'api_key',
      'knowledge_base_name',
      'dataset_ids_json',
      'revision',
      'last_test_status',
      'updated_by_user_id',
    ]));
    expect(botRagflowSyncStateColumns).toEqual(expect.arrayContaining([
      'bot_instance_id',
      'applied_revision',
      'sync_status',
      'last_sync_error',
      'last_synced_at',
    ]));
    expect(globalAdminMessageConfigColumns).toEqual(expect.arrayContaining([
      'id',
      'defer_failed_until_user_active',
      'assistant_name',
      'meal_consent_prompt',
      'meal_rain_reminder',
      'meal_standard_reminder',
      'morning_briefing_intro',
      'processing_ack',
      'wecom_ack',
      'wecom_duplicate',
      'wecom_completed',
      'wecom_failure',
      'wecom_unsupported',
      'wecom_group_unsupported',
      'wecom_unbound',
      'wecom_binding_name_prompt',
      'wecom_binding_name_invalid',
      'wecom_binding_success',
      'revision',
      'observed_revision',
      'updated_by_user_id',
      'created_at',
      'updated_at',
    ]));
    expect(globalEmailConfigColumns).toEqual(expect.arrayContaining([
      'id',
      'enabled',
      'smtp_host',
      'smtp_port',
      'smtp_security',
      'sender_email',
      'sender_name',
      'revision',
      'observed_revision',
      'updated_by_user_id',
      'created_at',
      'updated_at',
    ]));
    expect(emailDeliveryColumns).toEqual(expect.arrayContaining([
      'id',
      'semantic_key',
      'source',
      'bot_instance_id',
      'recipient_user_id',
      'recipient_email',
      'created_by_user_id',
      'subject',
      'message',
      'status',
      'attempt_count',
      'next_attempt_at',
      'last_error',
      'sent_at',
      'created_at',
      'updated_at',
    ]));
    expect(botWecomBindingColumns).toEqual([
      'bot_instance_id',
      'employee_id',
      'wecom_user_id',
      'enabled',
      'preferred_for_proactive',
      'last_inbound_at',
      'last_outbound_at',
      'last_error',
      'created_at',
      'updated_at',
    ]);
    expect(wecomMessageReceiptColumns).not.toContain('employee_id');
    expect(wecomMessageReceiptColumns).toContain('bot_instance_id');
    expect(wecomProactiveDeliveryColumns).not.toContain('employee_id');
    expect(wecomProactiveDeliveryColumns).toContain('bot_instance_id');
    expect(wecomOnboardingReceiptColumns).toEqual(expect.arrayContaining([
      'message_id',
      'wecom_user_id',
      'status',
      'response',
      'attempt_count',
      'received_at',
      'completed_at',
    ]));
    expect(wecomOnboardingSessionColumns).toEqual(expect.arrayContaining([
      'wecom_user_id',
      'status',
      'employee_id',
      'bot_instance_id',
      'attempt_count',
      'last_error',
      'last_prompt_at',
      'cooldown_until',
      'expires_at',
      'bound_at',
    ]));
  });

  it('creates a fresh SQLite database inside a missing storage/sqlite directory and applies the full migration baseline', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-db-default-sqlite-'));
    tempDirs.push(dir);

    const createdSqlitePath = join(dir, 'storage', 'sqlite', 'db.sqlite');

    const client = createDatabaseClient({
      url: `file:${createdSqlitePath}`,
    });
    clients.push(client);

    const expectedHashes = await getCurrentMigrationHashes();
    expect(() => migrateDatabase(client)).not.toThrow();
    expect(getAppliedMigrationHashes(client.connection)).toEqual(expectedHashes);
  });
});
