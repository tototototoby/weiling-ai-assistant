import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateDatabase } from '../../client.js';
import {
  closeTrackedDatabaseClients,
  createTrackedDatabaseClient as createDatabaseClient,
} from './test-database-client.js';
import { UserRepository } from '../user-repository';

const tempDirs: string[] = [];

afterEach(async () => {
  closeTrackedDatabaseClients();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('UserRepository', () => {
  it('counts persisted users', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-db-user-count-'));
    tempDirs.push(dir);

    const client = createDatabaseClient({
      url: `file:${join(dir, 'test.sqlite')}`,
    });
    migrateDatabase(client);

    const users = new UserRepository(client.db);

    await expect(users.countAll()).resolves.toBe(0);

    await users.create({
      id: 'user_1',
      email: 'bot@example.com',
      name: 'bot',
    });

    await expect(users.countAll()).resolves.toBe(1);
  });
});
