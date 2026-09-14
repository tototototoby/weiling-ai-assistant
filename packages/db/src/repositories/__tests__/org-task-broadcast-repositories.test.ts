import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseClient, migrateDatabase } from '../../client.js';
import { AdminMessageDeliveryRepository } from '../admin-message-delivery-repository.js';
import { BotDailyActivityRepository } from '../bot-daily-activity-repository.js';
import { DeliveryHealthCheckRepository } from '../delivery-health-check-repository.js';
import { EmployeeDirectoryRepository } from '../employee-directory-repository.js';
import { EmployeeGroupRepository } from '../employee-group-repository.js';
import { GlobalBroadcastConfigRepository } from '../global-broadcast-config-repository.js';
import { GlobalDeliveryHealthConfigRepository } from '../global-delivery-health-config-repository.js';
import { GlobalImagegenConfigRepository } from '../global-imagegen-config-repository.js';
import { GroupTaskRepository } from '../group-task-repository.js';
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
  await users.create({ id: 'admin', email: 'admin@example.com', name: 'Admin' });
  const directory = new EmployeeDirectoryRepository(client.db);
  const groups = new EmployeeGroupRepository(client.db);
  const tasks = new GroupTaskRepository(client.db);
  const bots = new BotInstanceRepository(client.db);
  const workspaces = new WorkspaceRepository(client.db);
  return {
    client,
    users,
    workspaces,
    directory,
    groups,
    tasks,
    bots,
    adminDeliveries: new AdminMessageDeliveryRepository(client.db),
    dailyActivity: new BotDailyActivityRepository(client.db),
    healthChecks: new DeliveryHealthCheckRepository(client.db),
    broadcastConfig: new GlobalBroadcastConfigRepository(client.db),
    healthConfig: new GlobalDeliveryHealthConfigRepository(client.db),
    imagegenConfig: new GlobalImagegenConfigRepository(client.db),
  };
}

async function createBot(
  bots: BotInstanceRepository,
  workspaces: WorkspaceRepository,
  id: string,
  ownerUserId: string,
) {
  const workspace = await workspaces.create({
    id: `ws_${id}`,
    ownerUserId,
    name: `ws_${id}`,
  });
  if (!workspace) {
    throw new Error(`Failed to create workspace ws_${id}`);
  }
  return bots.create({
    id,
    ownerUserId,
    workspaceId: workspace.id,
    name: id,
    provider: 'test',
    model: 'test-model',
    desiredState: 'stopped',
    status: 'stopped',
  });
}

async function createEmployee(directory: EmployeeDirectoryRepository, id: string, name: string) {
  await directory.create({
    id,
    legalName: name,
    nickname: name,
    normalizedLegalName: name,
    normalizedNickname: name,
  });
}

describe('v44 migration 0027', () => {
  it('creates the new tables and columns', async () => {
    const { client } = await setup();
    const connection = client.connection;
    const tables = connection
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => (row as { name: string }).name);
    for (const table of [
      'employee_groups',
      'group_tasks',
      'global_broadcast_configs',
      'global_delivery_health_configs',
      'global_imagegen_configs',
      'delivery_health_checks',
      'bot_daily_activity',
    ]) {
      expect(tables).toContain(table);
    }
    const groupColumns = connection
      .prepare('PRAGMA table_info(employee_directory_entries)')
      .all()
      .map((row) => (row as { name: string }).name);
    expect(groupColumns).toContain('group_id');
    const deliveryColumns = connection
      .prepare('PRAGMA table_info(admin_message_deliveries)')
      .all()
      .map((row) => (row as { name: string }).name);
    expect(deliveryColumns).toContain('metadata');
  });
});

describe('EmployeeGroupRepository', () => {
  it('creates groups, manages members, and resolves leaders', async () => {
    const { groups, directory } = await setup();
    await createEmployee(directory, 'leader', '组长');
    await createEmployee(directory, 'member_a', '组员A');
    await createEmployee(directory, 'member_b', '组员B');

    const group = await groups.create({
      id: 'group_1',
      name: '测试组',
      leaderEmployeeId: 'leader',
      createdByUserId: 'admin',
    });
    expect(group.leaderEmployeeId).toBe('leader');

    await directory.setGroup('member_a', group.id);
    await directory.setGroup('member_b', group.id);
    const members = await groups.listMemberEntries(group.id);
    expect(members.map((member) => member.id).sort()).toEqual(['member_a', 'member_b']);

    const byLeader = await groups.listByLeaderEmployeeId('leader');
    expect(byLeader.map((row) => row.id)).toContain('group_1');

    const updated = await groups.update(group.id, { name: '测试组2' });
    expect(updated?.name).toBe('测试组2');
    await expect(groups.findByName('测试组2')).resolves.toMatchObject({ id: 'group_1' });

    await groups.delete(group.id);
    await expect(groups.findById(group.id)).resolves.toBeNull();
  });
});

describe('GroupTaskRepository', () => {
  it('runs the assign -> submit -> accept flow and exposes reminder queries', async () => {
    const { groups, directory, tasks } = await setup();
    await createEmployee(directory, 'leader', '组长');
    await createEmployee(directory, 'worker', '组员');
    const group = await groups.create({ id: 'g', name: '组', leaderEmployeeId: 'leader' });
    await directory.setGroup('worker', group.id);

    const due = new Date(Date.now() + 24 * 3600 * 1000);
    const task = await tasks.create({
      id: 'task_1',
      groupId: group.id,
      assignerEmployeeId: 'leader',
      assigneeEmployeeId: 'worker',
      title: '写周报',
      description: '汇总本周工作',
      acceptanceCriteria: '格式完整',
      dueAt: due,
    });
    expect(task.status).toBe('pending');

    const active = await tasks.listActiveByAssignee('worker');
    expect(active.map((row) => row.id)).toContain('task_1');
    expect((await tasks.listDueSoon(new Date(), due)).map((row) => row.id)).toContain('task_1');

    const submitted = await tasks.markSubmitted('task_1', {
      summary: '已完成',
      evidencePaths: ['/tmp/report.pdf'],
    });
    expect(submitted?.status).toBe('submitted');
    expect(JSON.parse(submitted?.submittedEvidenceJson ?? '[]')).toEqual(['/tmp/report.pdf']);

    await tasks.needsRevision('task_1', '补一页数据');
    await expect(tasks.findById('task_1')).resolves.toMatchObject({ status: 'needs_revision' });

    await tasks.accept('task_1', null);
    await expect(tasks.findById('task_1')).resolves.toMatchObject({ status: 'accepted' });
    expect((await tasks.listDueSoon(new Date(), due)).length).toBe(0);
  });
});

describe('global config repositories', () => {
  it('broadcast config updates authorized ids and bumps revision', async () => {
    const { broadcastConfig } = await setup();
    await broadcastConfig.ensure();
    const updated = await broadcastConfig.update({
      enabled: true,
      authorizedEmployeeIds: ['emp_a'],
      rateLimitMinutes: 5,
      updatedByUserId: 'admin',
    });
    expect(updated.enabled).toBe(true);
    expect(JSON.parse(updated.authorizedEmployeeIdsJson)).toEqual(['emp_a']);
    expect(updated.revision).toBe(2);
  });

  it('delivery health and imagegen configs persist their values', async () => {
    const { healthConfig, imagegenConfig } = await setup();
    await healthConfig.ensure();
    const health = await healthConfig.update({
      enabled: true,
      checkTime: '08:30',
      failedThreshold: 5,
      stuckHours: 12,
      alertEmail: 'ops@example.com',
      updatedByUserId: 'admin',
    });
    expect(health.checkTime).toBe('08:30');

    await imagegenConfig.ensure();
    const imagegen = await imagegenConfig.update({
      enabled: true,
      endpoint: 'https://example.com/v1',
      apiKey: 'secret-key',
      model: 'gpt-image-2',
      updatedByUserId: 'admin',
    });
    expect(imagegen.apiKey).toBe('secret-key');
  });
});

describe('DeliveryHealthCheckRepository', () => {
  it('upserts once per date and lists recent history', async () => {
    const { healthChecks } = await setup();
    await healthChecks.upsertByDate({
      id: 'c1',
      checkDate: '2026-08-18',
      summaryJson: '{"failed": 2}',
      alertSent: false,
    });
    await healthChecks.upsertByDate({
      id: 'c2',
      checkDate: '2026-08-18',
      summaryJson: '{"failed": 3}',
      alertSent: true,
    });
    const row = await healthChecks.findByDate('2026-08-18');
    expect(row?.id).toBe('c1');
    expect(row?.summaryJson).toBe('{"failed": 3}');
    expect(row?.alertSent).toBe(true);
    expect((await healthChecks.listRecent(10)).length).toBe(1);
  });
});

describe('BotDailyActivityRepository', () => {
  it('increments per-bot daily counters and sums ranges', async () => {
    const { dailyActivity, bots, workspaces, users } = await setup();
    await users.create({ id: 'owner', email: 'owner@example.com', name: 'Owner' });
    await createBot(bots, workspaces, 'bot_a', 'owner');
    await createBot(bots, workspaces, 'bot_b', 'owner');
    await dailyActivity.incrementInbound('bot_a', '2026-08-18');
    await dailyActivity.incrementInbound('bot_a', '2026-08-18');
    await dailyActivity.incrementOutbound('bot_a', '2026-08-18');
    await dailyActivity.incrementInbound('bot_a', '2026-08-17');
    await dailyActivity.incrementInbound('bot_b', '2026-08-18');

    const range = await dailyActivity.sumRange('2026-08-17', '2026-08-18');
    const botA = range.find((row) => row.botInstanceId === 'bot_a');
    expect(botA?.inboundCount).toBe(3);
    expect(botA?.outboundCount).toBe(1);
    expect(range.find((row) => row.botInstanceId === 'bot_b')?.inboundCount).toBe(1);
  });
});

describe('AdminMessageDeliveryRepository metadata and summary', () => {
  it('persists metadata and summarizes by status', async () => {
    const { adminDeliveries, users, bots, workspaces, directory } = await setup();
    await createEmployee(directory, 'emp', '员工');
    await createBot(bots, workspaces, 'bot_1', 'admin');
    await adminDeliveries.createBatch([
      {
        id: 'd1',
        batchId: 'b1',
        botInstanceId: 'bot_1',
        recipientUserId: 'admin',
        createdByUserId: 'admin',
        message: 'hi',
        metadata: JSON.stringify({ scope: 'group', senderName: '组长' }),
      },
    ]);
    const rows = await adminDeliveries.listRecent(10);
    expect(JSON.parse(rows[0]?.metadata ?? '{}')).toMatchObject({ scope: 'group' });
    const summary = await adminDeliveries.summarizeByStatus(
      new Date(Date.now() - 3600 * 1000),
      new Date(Date.now() + 3600 * 1000),
    );
    expect(summary.pending ?? 0).toBe(1);
  });
});
