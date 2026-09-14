import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateDatabase } from '../../client.js';
import {
  closeTrackedDatabaseClients,
  createTrackedDatabaseClient as createDatabaseClient,
} from './test-database-client.js';
import { RegistrationBootstrapClaimRepository } from '../registration-bootstrap-claim-repository';
import { UserRepository } from '../user-repository';

const tempDirs: string[] = [];

afterEach(async () => {
  closeTrackedDatabaseClients();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('RegistrationBootstrapClaimRepository', () => {
  it('claims bootstrap registration only once until released or stale while the system has no users', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-db-bootstrap-claim-'));
    tempDirs.push(dir);

    const client = createDatabaseClient({
      url: `file:${join(dir, 'test.sqlite')}`,
    });
    migrateDatabase(client);

    const claims = new RegistrationBootstrapClaimRepository(client.db);

    const firstClaim = await claims.claim({
      claimToken: 'bootstrap_1',
      claimedAt: new Date('2026-04-08T00:00:00.000Z'),
      claimedByEmail: 'admin@example.com',
      staleBefore: new Date('2026-04-07T23:55:00.000Z'),
    });
    const secondClaim = await claims.claim({
      claimToken: 'bootstrap_2',
      claimedAt: new Date('2026-04-08T00:01:00.000Z'),
      claimedByEmail: 'ops@example.com',
      staleBefore: new Date('2026-04-07T23:56:00.000Z'),
    });

    await claims.release('bootstrap_1');

    const claimAfterRelease = await claims.claim({
      claimToken: 'bootstrap_3',
      claimedAt: new Date('2026-04-08T00:02:00.000Z'),
      claimedByEmail: 'ops@example.com',
      staleBefore: new Date('2026-04-07T23:57:00.000Z'),
    });
    const claimAfterStale = await claims.claim({
      claimToken: 'bootstrap_4',
      claimedAt: new Date('2026-04-08T00:10:00.000Z'),
      claimedByEmail: 'owner@example.com',
      staleBefore: new Date('2026-04-08T00:04:59.000Z'),
    });

    expect(firstClaim).toMatchObject({
      claimToken: 'bootstrap_1',
      claimedByEmail: 'admin@example.com',
    });
    expect(secondClaim).toBeNull();
    expect(claimAfterRelease).toMatchObject({
      claimToken: 'bootstrap_3',
      claimedByEmail: 'ops@example.com',
    });
    expect(claimAfterStale).toMatchObject({
      claimToken: 'bootstrap_4',
      claimedByEmail: 'owner@example.com',
    });
  });

  it('refuses bootstrap claims once any user already exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-db-bootstrap-claim-users-'));
    tempDirs.push(dir);

    const client = createDatabaseClient({
      url: `file:${join(dir, 'test.sqlite')}`,
    });
    migrateDatabase(client);

    const users = new UserRepository(client.db);
    const claims = new RegistrationBootstrapClaimRepository(client.db);

    await users.create({
      id: 'user_1',
      email: 'admin@example.com',
      name: 'admin',
    });

    await expect(claims.claim({
      claimToken: 'bootstrap_1',
      claimedAt: new Date('2026-04-08T00:00:00.000Z'),
      claimedByEmail: 'admin@example.com',
      staleBefore: new Date('2026-04-07T23:55:00.000Z'),
    })).resolves.toBeNull();
  });
});
