import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateDatabase } from '../../client.js';
import {
  closeTrackedDatabaseClients,
  createTrackedDatabaseClient as createDatabaseClient,
} from './test-database-client.js';
import { RegistrationInviteRepository } from '../registration-invite-repository';
import { UserRepository } from '../user-repository';

const tempDirs: string[] = [];

afterEach(async () => {
  closeTrackedDatabaseClients();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('RegistrationInviteRepository', () => {
  it('creates invites, finds them by code, and lists newest first', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-db-registration-invites-'));
    tempDirs.push(dir);

    const client = createDatabaseClient({
      url: `file:${join(dir, 'test.sqlite')}`,
    });
    migrateDatabase(client);

    const users = new UserRepository(client.db);
    const invites = new RegistrationInviteRepository(client.db);

    await users.create({
      id: 'admin_1',
      email: 'admin@example.com',
      name: 'admin',
    });

    const first = await invites.create({
      id: 'invite_1',
      code: 'INVITE-ONE',
      createdByUserId: 'admin_1',
      createdAt: new Date('2026-04-02T00:00:00.000Z'),
    });
    const second = await invites.create({
      id: 'invite_2',
      code: 'INVITE-TWO',
      createdByUserId: 'admin_1',
      createdAt: new Date('2026-04-02T00:01:00.000Z'),
    });

    const found = await invites.findByCode('INVITE-ONE');
    const recent = await invites.listRecent();

    expect(first).toMatchObject({
      code: 'INVITE-ONE',
      createdByUserId: 'admin_1',
      usedAt: null,
      usedByUserId: null,
    });
    expect(second).toMatchObject({
      code: 'INVITE-TWO',
      createdByUserId: 'admin_1',
    });
    expect(found).toMatchObject({
      id: 'invite_1',
      code: 'INVITE-ONE',
    });
    expect(recent.map((invite) => invite.id)).toEqual(['invite_2', 'invite_1']);
  });

  it('reserves available invites exactly once until the reservation is released or stale', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-db-registration-invite-consume-'));
    tempDirs.push(dir);

    const client = createDatabaseClient({
      url: `file:${join(dir, 'test.sqlite')}`,
    });
    migrateDatabase(client);

    const users = new UserRepository(client.db);
    const invites = new RegistrationInviteRepository(client.db);

    await users.create({
      id: 'admin_1',
      email: 'admin@example.com',
      name: 'admin',
    });
    await users.create({
      id: 'user_1',
      email: 'user@example.com',
      name: 'user',
    });
    await users.create({
      id: 'user_2',
      email: 'other@example.com',
      name: 'other',
    });

    await invites.create({
      id: 'invite_1',
      code: 'INVITE-ONE',
      createdByUserId: 'admin_1',
      createdAt: new Date('2026-04-02T00:00:00.000Z'),
    });
    await invites.create({
      id: 'invite_2',
      code: 'INVITE-TWO',
      createdByUserId: 'admin_1',
      createdAt: new Date('2026-04-02T00:00:30.000Z'),
    });

    const reserved = await invites.reserve({
      code: 'INVITE-ONE',
      reservationToken: 'reservation_1',
      reservedAt: new Date('2026-04-02T00:01:00.000Z'),
      reservedByEmail: 'user@example.com',
      staleBefore: new Date('2026-04-02T00:00:30.000Z'),
    });
    const reservedAgain = await invites.reserve({
      code: 'INVITE-ONE',
      reservationToken: 'reservation_2',
      reservedAt: new Date('2026-04-02T00:02:00.000Z'),
      reservedByEmail: 'other@example.com',
      staleBefore: new Date('2026-04-02T00:00:59.000Z'),
    });
    await invites.releaseReservation('reservation_1');
    const reservedAfterRelease = await invites.reserve({
      code: 'INVITE-ONE',
      reservationToken: 'reservation_3',
      reservedAt: new Date('2026-04-02T00:03:00.000Z'),
      reservedByEmail: 'other@example.com',
      staleBefore: new Date('2026-04-02T00:02:00.000Z'),
    });
    const staleReserved = await invites.reserve({
      code: 'INVITE-TWO',
      reservationToken: 'reservation_4',
      reservedAt: new Date('2026-04-02T00:04:00.000Z'),
      reservedByEmail: 'user@example.com',
      staleBefore: new Date('2026-04-02T00:03:00.000Z'),
    });
    const staleReservedAgain = await invites.reserve({
      code: 'INVITE-TWO',
      reservationToken: 'reservation_5',
      reservedAt: new Date('2026-04-02T00:09:00.000Z'),
      reservedByEmail: 'other@example.com',
      staleBefore: new Date('2026-04-02T00:08:00.000Z'),
    });

    expect(reserved).toMatchObject({
      code: 'INVITE-ONE',
      reservationToken: 'reservation_1',
      reservedByEmail: 'user@example.com',
    });
    expect(reservedAgain).toBeNull();
    expect(reservedAfterRelease).toMatchObject({
      code: 'INVITE-ONE',
      reservationToken: 'reservation_3',
      reservedByEmail: 'other@example.com',
    });
    expect(staleReserved).toMatchObject({
      code: 'INVITE-TWO',
      reservationToken: 'reservation_4',
      reservedByEmail: 'user@example.com',
    });
    expect(staleReservedAgain).toMatchObject({
      code: 'INVITE-TWO',
      reservationToken: 'reservation_5',
      reservedByEmail: 'other@example.com',
    });
  });

  it('consumes reserved invites exactly once', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-db-registration-invite-finalize-'));
    tempDirs.push(dir);

    const client = createDatabaseClient({
      url: `file:${join(dir, 'test.sqlite')}`,
    });
    migrateDatabase(client);

    const users = new UserRepository(client.db);
    const invites = new RegistrationInviteRepository(client.db);

    await users.create({
      id: 'admin_1',
      email: 'admin@example.com',
      name: 'admin',
    });
    await users.create({
      id: 'user_1',
      email: 'user@example.com',
      name: 'user',
    });
    await users.create({
      id: 'user_2',
      email: 'other@example.com',
      name: 'other',
    });

    await invites.create({
      id: 'invite_1',
      code: 'INVITE-ONE',
      createdByUserId: 'admin_1',
      createdAt: new Date('2026-04-02T00:00:00.000Z'),
    });
    await invites.reserve({
      code: 'INVITE-ONE',
      reservationToken: 'reservation_1',
      reservedAt: new Date('2026-04-02T00:01:00.000Z'),
      reservedByEmail: 'user@example.com',
      staleBefore: new Date('2026-04-02T00:00:30.000Z'),
    });

    const consumed = await invites.consumeReservation({
      reservationToken: 'reservation_1',
      usedAt: new Date('2026-04-02T00:02:00.000Z'),
      usedByUserId: 'user_1',
    });
    const consumedAgain = await invites.consumeReservation({
      reservationToken: 'reservation_1',
      usedAt: new Date('2026-04-02T00:03:00.000Z'),
      usedByUserId: 'user_2',
    });

    expect(consumed).toMatchObject({
      code: 'INVITE-ONE',
      reservationToken: null,
      reservedAt: null,
      reservedByEmail: null,
      usedByUserId: 'user_1',
      usedAt: new Date('2026-04-02T00:02:00.000Z'),
    });
    expect(consumedAgain).toBeNull();
  });

  it('deletes only unused and unreserved invites', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-db-registration-invite-delete-'));
    tempDirs.push(dir);

    const client = createDatabaseClient({
      url: `file:${join(dir, 'test.sqlite')}`,
    });
    migrateDatabase(client);

    const users = new UserRepository(client.db);
    const invites = new RegistrationInviteRepository(client.db);

    await users.create({
      id: 'admin_1',
      email: 'admin@example.com',
      name: 'admin',
    });
    await users.create({
      id: 'user_1',
      email: 'user@example.com',
      name: 'user',
    });

    await invites.create({
      id: 'invite_unused',
      code: 'INVITE-UNUSED',
      createdByUserId: 'admin_1',
      createdAt: new Date('2026-04-02T00:00:00.000Z'),
    });
    await invites.create({
      id: 'invite_reserved',
      code: 'INVITE-RESERVED',
      createdByUserId: 'admin_1',
      createdAt: new Date('2026-04-02T00:01:00.000Z'),
    });
    await invites.create({
      id: 'invite_used',
      code: 'INVITE-USED',
      createdByUserId: 'admin_1',
      createdAt: new Date('2026-04-02T00:02:00.000Z'),
    });

    await invites.reserve({
      code: 'INVITE-RESERVED',
      reservationToken: 'reservation_1',
      reservedAt: new Date('2026-04-02T00:03:00.000Z'),
      reservedByEmail: 'user@example.com',
      staleBefore: new Date('2026-04-02T00:02:00.000Z'),
    });
    await invites.reserve({
      code: 'INVITE-USED',
      reservationToken: 'reservation_2',
      reservedAt: new Date('2026-04-02T00:04:00.000Z'),
      reservedByEmail: 'user@example.com',
      staleBefore: new Date('2026-04-02T00:03:00.000Z'),
    });
    await invites.consumeReservation({
      reservationToken: 'reservation_2',
      usedAt: new Date('2026-04-02T00:05:00.000Z'),
      usedByUserId: 'user_1',
    });

    const repository = invites as unknown as {
      deleteUnusedById(id: string): Promise<{ id: string } | null>;
    };

    const deleted = await repository.deleteUnusedById('invite_unused');
    const reserved = await repository.deleteUnusedById('invite_reserved');
    const used = await repository.deleteUnusedById('invite_used');
    const missing = await invites.findById('invite_unused');

    expect(deleted).toMatchObject({
      id: 'invite_unused',
    });
    expect(reserved).toBeNull();
    expect(used).toBeNull();
    expect(missing).toBeNull();
  });
});
