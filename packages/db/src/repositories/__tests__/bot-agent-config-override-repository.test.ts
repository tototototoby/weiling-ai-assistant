import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseClient, migrateDatabase } from '../../client.js';
import { BotAgentConfigOverrideRepository } from '../bot-agent-config-override-repository.js';
import { BotInstanceRepository } from '../bot-instance-repository.js';
import { UserRepository } from '../user-repository.js';
import { WorkspaceRepository } from '../workspace-repository.js';

const clients: Array<ReturnType<typeof createDatabaseClient>> = [];
const tempDirs: string[] = [];

afterEach(async () => {
  clients.splice(0).forEach((client) => client.close());
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('BotAgentConfigOverrideRepository', () => {
  it('records immutable revisions and restores an earlier configuration as a new revision', async () => {
    const repository = await createFixture();
    await repository.update('bot_1', {
      agentsAppendix: '# First rule',
      changeReason: 'Initial support adjustment',
      soulAppendix: '# First tone',
      updatedByEmail: 'ADMIN@EXAMPLE.COM',
    });
    await repository.update('bot_1', {
      agentsAppendix: '# Second rule',
      changeReason: 'Follow-up adjustment',
      soulAppendix: '',
      updatedByEmail: 'admin@example.com',
    });

    const restored = await repository.restoreRevision('bot_1', 1, {
      changeReason: 'Rollback after validation',
      updatedByEmail: 'admin@example.com',
    });
    const history = await repository.listRevisions('bot_1');

    expect(restored).toMatchObject({
      agentsAppendix: '# First rule',
      revision: 3,
      soulAppendix: '# First tone',
    });
    expect(history.map((item) => item.revision)).toEqual([3, 2, 1]);
    expect(history[2]).toMatchObject({
      changeReason: 'Initial support adjustment',
      updatedByEmail: 'admin@example.com',
    });
  });

  it('returns null when the requested historical revision does not belong to the Bot', async () => {
    const repository = await createFixture();
    await expect(repository.restoreRevision('bot_1', 99, {
      changeReason: 'Unknown rollback',
      updatedByEmail: 'admin@example.com',
    })).resolves.toBeNull();
  });
});

async function createFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'weiling-bot-agent-override-'));
  tempDirs.push(dir);
  const client = createDatabaseClient({ baseDir: dir, url: 'file:db.sqlite' });
  clients.push(client);
  migrateDatabase(client);
  const users = new UserRepository(client.db);
  const workspaces = new WorkspaceRepository(client.db);
  const bots = new BotInstanceRepository(client.db);
  const now = new Date('2026-07-22T00:00:00.000Z');
  await users.create({
    email: 'employee@example.com',
    emailVerified: true,
    id: 'user_1',
    name: 'Employee',
  });
  await workspaces.create({ id: 'workspace_1', ownerUserId: 'user_1', name: 'Workspace' });
  await bots.create({
    desiredState: 'running',
    id: 'bot_1',
    model: 'model',
    name: 'Bot',
    ownerUserId: 'user_1',
    provider: 'provider',
    status: 'provisioning',
    workspaceId: 'workspace_1',
  });
  return new BotAgentConfigOverrideRepository(client.db);
}
