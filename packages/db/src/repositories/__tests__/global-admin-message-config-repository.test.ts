import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseClient, migrateDatabase } from '../../client.js';
import { DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY } from '../../schema/global-admin-message-configs.js';
import { GlobalAdminMessageConfigRepository } from '../global-admin-message-config-repository.js';
import { UserRepository } from '../user-repository.js';

const clients: Array<ReturnType<typeof createDatabaseClient>> = [];

afterEach(() => {
  clients.splice(0).forEach((client) => client.close());
});

describe('GlobalAdminMessageConfigRepository message copy', () => {
  it('materializes the complete default copy snapshot', async () => {
    const { configs } = await createFixture();
    const createdAt = new Date('2026-07-28T01:00:00.000Z');

    const config = await configs.ensure(createdAt);

    expect(config).toMatchObject({
      ...DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY,
      createdAt: expect.any(Date),
      deferFailedUntilUserActive: true,
      id: 'global',
      observedRevision: null,
      revision: 3,
      updatedAt: expect.any(Date),
      updatedByUserId: null,
    });
  });

  it('normalizes copy changes, advances revision once, and preserves unchanged metadata', async () => {
    const { configs } = await createFixture();
    const createdAt = new Date('2026-07-28T01:00:00.000Z');
    const updatedAt = new Date('2026-07-28T01:01:00.000Z');
    const ensured = await configs.ensure(createdAt);
    await configs.recordObservedRevision(1);

    const updated = await configs.update({
      assistantName: ' 微Link ',
      mealStandardReminder: ' {{assistantName}}提醒你安排午餐。 ',
      updatedAt,
      updatedByUserId: 'user_1',
    });
    const unchanged = await configs.update({
      assistantName: '微Link',
      mealStandardReminder: '{{assistantName}}提醒你安排午餐。',
      updatedAt: new Date('2026-07-28T01:02:00.000Z'),
      updatedByUserId: 'user_1',
    });

    expect(updated).toMatchObject({
      assistantName: '微Link',
      createdAt: ensured.createdAt,
      mealStandardReminder: '{{assistantName}}提醒你安排午餐。',
      observedRevision: null,
      revision: 4,
      updatedAt,
      updatedByUserId: 'user_1',
    });
    expect(unchanged).toEqual(updated);
  });

  it('records only the currently published revision as observed', async () => {
    const { configs } = await createFixture();
    await configs.ensure();
    await configs.update({ processingAck: '{{assistantName}}正在处理。' });

    await expect(configs.recordObservedRevision(1)).resolves.toMatchObject({
      observedRevision: null,
      revision: 4,
    });
    await expect(configs.recordObservedRevision(4)).resolves.toMatchObject({
      observedRevision: 4,
      revision: 4,
    });
    await expect(configs.recordObservedRevision(0)).rejects.toThrow('positive integer');
  });

  it('rejects empty, unsafe, oversized, and unsupported template values', async () => {
    const { configs } = await createFixture();
    await configs.ensure();

    await expect(configs.update({ wecomAck: '   ' })).rejects.toThrow('must not be empty');
    await expect(configs.update({ wecomAck: '收到\n处理中' })).rejects.toThrow('control characters');
    await expect(configs.update({ wecomAck: '{{unknown}}' })).rejects.toThrow('unsupported template');
    await expect(configs.update({ wecomAck: '{{ assistantName }}' })).rejects.toThrow('invalid template');
    await expect(configs.update({ assistantName: '{{assistantName}}' })).rejects.toThrow(
      'must not contain template variables',
    );
    await expect(configs.update({ wecomFailure: 'x'.repeat(4_001) })).rejects.toThrow(
      'must not exceed 4000 characters',
    );
  });
});

async function createFixture() {
  const client = createDatabaseClient({ url: ':memory:' });
  clients.push(client);
  migrateDatabase(client);
  await new UserRepository(client.db).create({
    email: 'admin@example.com',
    id: 'user_1',
    name: 'Admin',
  });
  return {
    client,
    configs: new GlobalAdminMessageConfigRepository(client.db),
  };
}
