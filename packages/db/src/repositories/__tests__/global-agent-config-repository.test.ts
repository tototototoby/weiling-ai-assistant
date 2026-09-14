import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabaseClient, migrateDatabase } from '../../client.js';
import { BotAgentConfigSyncRepository } from '../bot-agent-config-sync-repository.js';
import { BotInstanceRepository } from '../bot-instance-repository.js';
import { GlobalAgentConfigRepository } from '../global-agent-config-repository.js';
import { UserRepository } from '../user-repository.js';
import { WorkspaceRepository } from '../workspace-repository.js';

const clients: Array<ReturnType<typeof createDatabaseClient>> = [];
const tempDirs: string[] = [];

afterEach(async () => {
  clients.splice(0).forEach((client) => client.close());
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('GlobalAgentConfigRepository', () => {
  it('materializes one caller-provided global snapshot without replacing it on repeated ensure', async () => {
    const { configs } = await createRepositoryFixture();
    const createdAt = new Date('2026-07-21T01:00:00.000Z');

    const first = await configs.ensure({
      agentsMarkdown: '# AGENTS',
      createdAt,
      skills: [
        { enabled: true, skillName: 'weather' },
        { enabled: false, skillName: 'lark-mail' },
      ],
      soulMarkdown: '# SOUL',
    });
    const second = await configs.ensure({
      agentsMarkdown: '# replacement',
      skills: [],
      soulMarkdown: '# replacement',
    });

    expect(first.config).toMatchObject({
      agentsMarkdown: '# AGENTS',
      id: 'global',
      revision: 1,
      soulMarkdown: '# SOUL',
    });
    expect(first.skills).toEqual([
      expect.objectContaining({ enabled: false, skillName: 'lark-mail' }),
      expect.objectContaining({ enabled: true, skillName: 'weather' }),
    ]);
    expect(second).toEqual(first);
  });

  it('increments revision and marks every bot pending only when documents change', async () => {
    const { configs, syncStates } = await createInitializedFixture();
    await syncStates.ensureForAllBots();
    await syncStates.markSyncSucceeded('bot_1', {
      appliedOverrideRevision: 0,
      appliedRevision: 1,
      lastSyncedAt: new Date('2026-07-21T01:01:00.000Z'),
    });

    const unchanged = await configs.updateDocuments({ agentsMarkdown: '# AGENTS' });
    const changed = await configs.updateDocuments({
      agentsMarkdown: '# AGENTS v2',
      updatedAt: new Date('2026-07-21T01:02:00.000Z'),
    });
    const botOne = await syncStates.findByBotId('bot_1');
    const botTwo = await syncStates.findByBotId('bot_2');

    expect(unchanged?.revision).toBe(1);
    expect(changed?.revision).toBe(2);
    expect(botOne).toMatchObject({ appliedRevision: 1, syncStatus: 'pending' });
    expect(botTwo).toMatchObject({ appliedRevision: 0, syncStatus: 'pending' });
  });

  it('uses one revision for actual single and bulk skill policy changes', async () => {
    const { configs } = await createInitializedFixture();

    const unchanged = await configs.setSkillEnabled('weather', true);
    const changed = await configs.setSkillEnabled('weather', false);
    const bulkChanged = await configs.bulkSetSkills([
      { enabled: true, skillName: 'weather' },
      { enabled: true, skillName: 'html-report' },
    ]);
    const snapshot = await configs.getSnapshot();

    expect(unchanged?.revision).toBe(1);
    expect(changed?.revision).toBe(2);
    expect(bulkChanged?.revision).toBe(3);
    expect(snapshot?.skills).toEqual([
      expect.objectContaining({ enabled: true, skillName: 'html-report' }),
      expect.objectContaining({ enabled: true, skillName: 'weather' }),
    ]);
  });

  it('rejects blank documents and skill names', async () => {
    const { configs } = await createInitializedFixture();

    await expect(configs.updateDocuments({ soulMarkdown: '   ' }))
      .rejects.toThrow('Global SOUL.md content must not be empty.');
    await expect(configs.setSkillEnabled('  ', true))
      .rejects.toThrow('Global skill name must not be empty.');
  });
});

describe('BotAgentConfigSyncRepository', () => {
  it('ensures one pending sync state for every bot', async () => {
    const { syncStates } = await createInitializedFixture();

    const states = await syncStates.ensureForAllBots(new Date('2026-07-21T01:03:00.000Z'));

    expect(states).toHaveLength(2);
    expect(states.every((state) => state.appliedRevision === 0)).toBe(true);
    expect(states.every((state) => state.syncStatus === 'pending')).toBe(true);
  });

  it('records success and failure without allowing impossible applied revisions', async () => {
    const { configs, syncStates } = await createInitializedFixture();
    await syncStates.ensureForBot('bot_1');

    const succeeded = await syncStates.markSyncSucceeded('bot_1', {
      appliedOverrideRevision: 0,
      appliedRevision: 1,
      lastSyncedAt: new Date('2026-07-21T01:04:00.000Z'),
    });
    const failed = await syncStates.markSyncFailed('bot_1', {
      error: 'workspace unavailable',
      lastSyncedAt: new Date('2026-07-21T01:05:00.000Z'),
    });
    await configs.updateDocuments({ soulMarkdown: '# SOUL v2' });

    await expect(syncStates.markSyncSucceeded('bot_1', {
      appliedOverrideRevision: 0,
      appliedRevision: 3,
    }))
      .rejects.toThrow('Applied agent config revision cannot exceed global revision.');
    expect(succeeded).toMatchObject({ appliedRevision: 1, syncStatus: 'synced' });
    expect(failed).toMatchObject({
      appliedRevision: 1,
      lastSyncError: 'workspace unavailable',
      syncStatus: 'error',
    });
  });

  it('cascades sync state deletion with its bot', async () => {
    const { client, syncStates } = await createInitializedFixture();
    await syncStates.ensureForBot('bot_1');

    client.connection.prepare("DELETE FROM bot_instances WHERE id = 'bot_1'").run();

    await expect(syncStates.findByBotId('bot_1')).resolves.toBeNull();
  });
});

async function createInitializedFixture() {
  const fixture = await createRepositoryFixture();
  await fixture.configs.ensure({
    agentsMarkdown: '# AGENTS',
    skills: [{ enabled: true, skillName: 'weather' }],
    soulMarkdown: '# SOUL',
  });
  return fixture;
}

async function createRepositoryFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'weiling-global-agent-config-'));
  tempDirs.push(dir);
  const client = createDatabaseClient({ url: `file:${join(dir, 'test.sqlite')}` });
  clients.push(client);
  migrateDatabase(client);

  const users = new UserRepository(client.db);
  const workspaces = new WorkspaceRepository(client.db);
  const bots = new BotInstanceRepository(client.db);
  await users.create({ email: 'admin@example.com', id: 'user_1', name: 'Admin' });
  await workspaces.create({ id: 'ws_1', name: 'One', ownerUserId: 'user_1' });
  await workspaces.create({ id: 'ws_2', name: 'Two', ownerUserId: 'user_1' });
  await bots.create({
    desiredState: 'running',
    id: 'bot_1',
    model: 'test',
    name: 'One',
    ownerUserId: 'user_1',
    provider: 'openai',
    status: 'stopped',
    workspaceId: 'ws_1',
  });
  await bots.create({
    desiredState: 'running',
    id: 'bot_2',
    model: 'test',
    name: 'Two',
    ownerUserId: 'user_1',
    provider: 'openai',
    status: 'stopped',
    workspaceId: 'ws_2',
  });

  return {
    client,
    configs: new GlobalAgentConfigRepository(client.db),
    syncStates: new BotAgentConfigSyncRepository(client.db),
  };
}
