import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseClient, migrateDatabase } from '../../client.js';
import { EmployeeDirectoryRepository } from '../employee-directory-repository.js';
import { EmployeeInviteLinkRepository } from '../employee-invite-link-repository.js';
import { UserRepository } from '../user-repository.js';

const clients: Array<ReturnType<typeof createDatabaseClient>> = [];

afterEach(() => clients.splice(0).forEach((client) => client.close()));

async function setup() {
  const client = createDatabaseClient({ url: ':memory:' });
  clients.push(client);
  migrateDatabase(client);
  const users = new UserRepository(client.db);
  await users.create({ id: 'admin', email: 'admin@example.com', name: 'Admin' });
  const links = new EmployeeInviteLinkRepository(client.db);
  await links.create({ id: 'invite', token: 'multi-use-token', createdByUserId: 'admin' });
  return { directory: new EmployeeDirectoryRepository(client.db), links, users };
}

describe('EmployeeDirectoryRepository', () => {
  it('rejects an ambiguous legal name but permits a unique nickname', async () => {
    const { directory } = await setup();
    await directory.create({
      id: 'employee_1',
      legalName: '张三',
      nickname: '小张',
      normalizedLegalName: '张三',
      normalizedNickname: '小张',
    });
    await directory.create({
      id: 'employee_2',
      legalName: '张三',
      nickname: '阿三',
      normalizedLegalName: '张三',
      normalizedNickname: '阿三',
    });

    await expect(directory.reserveByInviteAndName({
      inviteToken: 'multi-use-token',
      normalizedName: '张三',
      reservationToken: 'ambiguous',
      staleBefore: new Date(0),
    })).resolves.toBeNull();

    await expect(directory.reserveByInviteAndName({
      inviteToken: 'multi-use-token',
      normalizedName: '小张',
      reservationToken: 'unique',
      staleBefore: new Date(0),
    })).resolves.toMatchObject({ id: 'employee_1', reservationToken: 'unique' });
  });

  it('allows a reusable link to claim different employees but not the same employee twice', async () => {
    const { directory, links, users } = await setup();
    for (const id of ['employee_1', 'employee_2']) {
      await directory.create({
        id,
        legalName: id,
        nickname: null,
        normalizedLegalName: id,
        normalizedNickname: null,
      });
      const token = `reservation_${id}`;
      await users.create({ id: `user_${id}`, email: `${id}@example.com`, name: id });
      await directory.reserveByInviteAndName({
        inviteToken: 'multi-use-token',
        normalizedName: id,
        reservationToken: token,
        staleBefore: new Date(0),
      });
      await expect(directory.claimReservation(token, `user_${id}`)).resolves.toMatchObject({ id });
    }

    await expect(directory.reserveByInviteAndName({
      inviteToken: 'multi-use-token',
      normalizedName: 'employee_1',
      reservationToken: 'duplicate',
      staleBefore: new Date(0),
    })).resolves.toBeNull();
    await expect(links.findById('invite')).resolves.toMatchObject({ usageCount: 2 });
  });

  it('claims an employee without binding a user account', async () => {
    const { directory, links } = await setup();
    await directory.create({
      id: 'employee_1',
      legalName: '张三',
      nickname: null,
      normalizedLegalName: '张三',
      normalizedNickname: null,
    });

    await directory.reserveByInviteAndName({
      inviteToken: 'multi-use-token',
      normalizedName: '张三',
      reservationToken: 'reservation_1',
      staleBefore: new Date(0),
    });
    const claimed = await directory.claimReservationWithoutUser('reservation_1', 'bot_1');

    expect(claimed).toMatchObject({
      id: 'employee_1',
      claimedBotInstanceId: 'bot_1',
      claimedByUserId: null,
      claimedViaInviteId: 'invite',
      reservationToken: null,
    });
    await expect(links.findById('invite')).resolves.toMatchObject({ usageCount: 1 });
  });

  it('allows administrators to delete claimed employee records', async () => {
    const { directory } = await setup();
    await directory.create({
      id: 'employee_1',
      legalName: '张三',
      nickname: null,
      normalizedLegalName: '张三',
      normalizedNickname: null,
    });

    expect(await directory.deleteById('employee_1')).toBe(true);
    expect(await directory.findById('employee_1')).toBeNull();
    expect(await directory.deleteById('employee_1')).toBe(false);
  });

  it('finds a previously claimed Bot for a retry with the same invite and name', async () => {
    const { directory } = await setup();
    await directory.create({
      id: 'employee_1',
      legalName: '张三',
      nickname: null,
      normalizedLegalName: '张三',
      normalizedNickname: null,
    });
    await directory.reserveByInviteAndName({
      inviteToken: 'multi-use-token',
      normalizedName: '张三',
      reservationToken: 'reservation_1',
      staleBefore: new Date(0),
    });
    await directory.claimReservationWithoutUser('reservation_1', 'bot_1');

    await expect(directory.findClaimedByInviteAndName('multi-use-token', '张三')).resolves.toMatchObject({
      claimedBotInstanceId: 'bot_1',
      id: 'employee_1',
    });
  });
});
