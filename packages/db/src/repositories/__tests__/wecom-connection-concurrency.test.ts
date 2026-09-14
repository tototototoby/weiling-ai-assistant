import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabaseClient, migrateDatabase } from '../../client.js';
import { GlobalWecomConfigRepository } from '../global-wecom-config-repository.js';
import { UserRepository } from '../user-repository.js';

const tempDirs: string[] = [];
const clients: Array<ReturnType<typeof createDatabaseClient>> = [];

afterEach(async () => {
  clients.splice(0).forEach((client) => client.close());
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('GlobalWecomConfigRepository connection status concurrency', () => {
  it('does not let an old revision overwrite a newer revision from another connection', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weiling-wecom-connection-concurrency-'));
    tempDirs.push(dir);
    const url = `file:${join(dir, 'test.sqlite')}`;
    const firstClient = createDatabaseClient({ url });
    const secondClient = createDatabaseClient({ url });
    clients.push(firstClient, secondClient);
    migrateDatabase(firstClient);
    migrateDatabase(secondClient);

    await new UserRepository(firstClient.db).create({
      email: 'admin@example.com',
      id: 'admin',
      name: 'Admin',
    });
    const first = new GlobalWecomConfigRepository(firstClient.db);
    const second = new GlobalWecomConfigRepository(secondClient.db);
    await first.ensure(new Date('2026-07-27T06:00:00.000Z'));
    const enabled = await first.update({
      botId: 'bot-one',
      enabled: true,
      secret: 'secret',
      updatedByUserId: 'admin',
    });
    const connectedAt = new Date('2026-07-27T06:01:00.000Z');
    await first.recordConnectionStatus({
      connectedAt,
      observedRevision: enabled.revision,
      status: 'connected',
      updatedAt: connectedAt,
    });

    const reconnected = await second.requestReconnect({
      requestedAt: new Date('2026-07-27T06:02:00.000Z'),
      updatedByUserId: 'admin',
    });
    const stale = await first.recordConnectionStatus({
      error: 'old connection failure',
      observedRevision: enabled.revision,
      status: 'error',
      updatedAt: new Date('2026-07-27T06:03:00.000Z'),
    });

    expect(reconnected).toMatchObject({
      connectionStatus: 'connecting',
      revision: enabled.revision + 1,
    });
    expect(stale).toMatchObject({
      connectionStatus: 'connecting',
      lastError: null,
      observedRevision: null,
      revision: reconnected.revision,
    });
  });
});
