import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseClient, migrateDatabase } from '../../client.js';
import { EmailDeliveryRepository } from '../email-delivery-repository.js';
import { GlobalEmailConfigRepository } from '../global-email-config-repository.js';
import { BotInstanceRepository } from '../bot-instance-repository.js';
import { UserRepository } from '../user-repository.js';
import { WorkspaceRepository } from '../workspace-repository.js';

const clients: Array<ReturnType<typeof createDatabaseClient>> = [];

afterEach(() => clients.splice(0).forEach((client) => client.close()));

async function setup() {
  const client = createDatabaseClient({ url: ':memory:' });
  clients.push(client);
  migrateDatabase(client);
  const users = new UserRepository(client.db);
  const workspaces = new WorkspaceRepository(client.db);
  const bots = new BotInstanceRepository(client.db);
  await users.create({ email: 'admin@example.com', id: 'user_1', name: 'Admin' });
  await workspaces.create({ id: 'workspace_1', name: 'Workspace', ownerUserId: 'user_1' });
  await bots.create({
    desiredState: 'running', id: 'bot_1', model: 'test', name: 'Bot', ownerUserId: 'user_1',
    provider: 'openai', status: 'stopped', workspaceId: 'workspace_1',
  });
  return {
    configs: new GlobalEmailConfigRepository(client.db),
    deliveries: new EmailDeliveryRepository(client.db),
  };
}

describe('GlobalEmailConfigRepository', () => {
  it('advances revision only for material changes', async () => {
    const { configs } = await setup();
    await configs.ensure();
    const first = await configs.update({
      enabled: true,
      senderEmail: 'sender@example.com',
      senderName: 'Sender',
      smtpHost: 'smtp.example.com',
      smtpPort: 465,
      smtpSecurity: 'ssl',
      updatedByUserId: 'user_1',
    });
    const same = await configs.update({
      enabled: true,
      senderEmail: ' SENDER@example.com ',
      senderName: 'Sender',
      smtpHost: 'smtp.example.com',
      smtpPort: 465,
      smtpSecurity: 'ssl',
      updatedByUserId: 'user_1',
    });
    expect(first.revision).toBe(2);
    expect(same.revision).toBe(2);
  });
});

describe('EmailDeliveryRepository', () => {
  it('deduplicates by semantic key and transitions failed deliveries', async () => {
    const { deliveries } = await setup();
    const input = {
      botInstanceId: 'bot_1', createdByUserId: 'user_1', id: 'delivery_1',
      message: 'hello', recipientEmail: 'person@example.com', recipientUserId: 'user_1',
      semanticKey: 'admin-email:batch:bot_1', source: 'admin' as const, subject: 'Notice',
    };
    await deliveries.createBatch([input]);
    const [claimed] = await deliveries.claimReady({ now: new Date(), limit: 1 });
    expect(claimed.status).toBe('delivering');
    await expect(deliveries.createBatch([{ ...input, id: 'different-id' }])).resolves.toHaveLength(1);
    await expect(deliveries.markAttemptFailed({ error: 'temporary', id: input.id, maxAttempts: 1 })).resolves.toBe('failed');
  });
});
