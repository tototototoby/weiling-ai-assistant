import {
  BotAgentConfigSyncRepository,
  BotInstanceRepository,
  GlobalAgentConfigRepository,
  createDatabaseClient,
  migrateDatabase,
} from '@weiling-ai/db';
import { afterEach, describe, expect, it } from 'vitest';
import {
  listAdminGlobalAgent,
  republishAdminGlobalAgent,
  updateAdminGlobalAgentDocuments,
  updateAdminGlobalAgentSkill,
} from '../global-agent-admin';

const clients: Array<ReturnType<typeof createDatabaseClient>> = [];

afterEach(() => {
  clients.splice(0).forEach((client) => client.close());
});

describe('global agent admin service', () => {
  it('seeds the complete curated bundle and publishes document and skill revisions', async () => {
    const repositories = createRepositories();
    const initial = await listAdminGlobalAgent(repositories);

    expect(initial.config.revision).toBe(1);
    expect(initial.skills).toHaveLength(42);
    expect(initial.skills.map((skill) => skill.name)).toEqual(expect.arrayContaining([
      'enterprise-mail',
      'html-report',
      'weiling-assistant',
      'morning-briefing',
      'broadcast-notice',
      'group-task',
      'poster-design',
    ]));
    expect(initial.skills.some((skill) => skill.name.startsWith('lark-'))).toBe(true);

    const documents = await updateAdminGlobalAgentDocuments({
      payload: {
        agentsMarkdown: `${initial.config.agentsMarkdown}\n\n# Published`,
        soulMarkdown: initial.config.soulMarkdown,
      },
      repositories,
    });
    expect(documents.config.revision).toBe(2);

    const skills = await updateAdminGlobalAgentSkill({
      payload: { enabled: false },
      repositories,
      skillName: 'weather',
    });
    expect(skills.config.revision).toBe(3);
    expect(skills.skills.find((skill) => skill.name === 'weather')?.enabled).toBe(false);

    const republished = await republishAdminGlobalAgent(repositories);
    expect(republished.config.revision).toBe(3);
  });

  it('rejects unknown skill names instead of creating arbitrary policies', async () => {
    const repositories = createRepositories();

    await expect(updateAdminGlobalAgentSkill({
      payload: { enabled: true },
      repositories,
      skillName: '../outside',
    })).rejects.toMatchObject({ code: 'GLOBAL_AGENT_SKILL_NOT_FOUND', status: 404 });
  });
});

function createRepositories() {
  const client = createDatabaseClient({ url: ':memory:' });
  clients.push(client);
  migrateDatabase(client);

  return {
    botAgentConfigSyncStates: new BotAgentConfigSyncRepository(client.db),
    botInstances: new BotInstanceRepository(client.db),
    globalAgentConfigs: new GlobalAgentConfigRepository(client.db),
  };
}
