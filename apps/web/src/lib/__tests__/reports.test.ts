import { describe, expect, it, vi } from 'vitest';
import { getAdminReports } from '../reports';

describe('admin reports aggregation', () => {
  it('merges daily activity, delivery statuses, failures, and email counts', async () => {
    const repositories = createRepositories();

    const report = await getAdminReports(7, repositories as never);

    expect(repositories.botDailyActivity.sumRange).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
    expect(report.activity).toEqual([
      expect.objectContaining({
        botInstanceId: 'bot_1',
        botName: 'Bot One',
        ownerEmail: 'admin@example.com',
        inbound: 3,
        outbound: 2,
      }),
      expect.objectContaining({
        botInstanceId: 'bot_2',
        botName: 'Bot Two',
        ownerEmail: 'owner@example.com',
        inbound: 0,
        outbound: 0,
      }),
    ]);
    expect(report.delivery.totalsByStatus).toEqual({
      sent: 1,
      failed: 1,
      waiting_for_user: 1,
    });
    expect(report.delivery.recentFailures).toHaveLength(2);
    expect(report.email).toEqual({ sent: 2, failed: 1, total: 3 });
  });

  it('rejects unsupported report day ranges', async () => {
    const repositories = createRepositories();
    await expect(getAdminReports(90, repositories as never)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
  });
});

function createRepositories() {
  return {
    adminMessageDeliveries: {
      listRecent: vi.fn().mockResolvedValue([
        {
          id: 'delivery_1',
          batchId: 'batch_1',
          botInstanceId: 'bot_1',
          recipientUserId: 'user_1',
          status: 'sent',
          lastError: null,
          message: 'ok',
          createdAt: new Date('2026-08-24T01:00:00.000Z'),
          updatedAt: new Date('2026-08-24T01:00:00.000Z'),
        },
        {
          id: 'delivery_2',
          batchId: 'batch_2',
          botInstanceId: 'bot_1',
          recipientUserId: 'user_1',
          status: 'failed',
          lastError: 'provider down',
          message: 'bad',
          createdAt: new Date('2026-08-24T02:00:00.000Z'),
          updatedAt: new Date('2026-08-24T02:00:00.000Z'),
        },
        {
          id: 'delivery_3',
          batchId: 'batch_3',
          botInstanceId: 'bot_1',
          recipientUserId: 'user_1',
          status: 'waiting_for_user',
          lastError: 'no conversation',
          message: 'waiting',
          createdAt: new Date('2026-08-24T03:00:00.000Z'),
          updatedAt: new Date('2026-08-24T03:00:00.000Z'),
        },
      ]),
    },
    botDailyActivity: {
      sumRange: vi.fn().mockResolvedValue([{
        botInstanceId: 'bot_1',
        inboundCount: 3,
        outboundCount: 2,
      }]),
    },
    botInstances: {
      listAllForAdministration: vi.fn().mockResolvedValue([
        { id: 'bot_1', name: 'Bot One', ownerUserId: 'user_1' },
        { id: 'bot_2', name: 'Bot Two', ownerUserId: 'user_2' },
      ]),
    },
    emailDeliveries: {
      listRecent: vi.fn().mockResolvedValue([
        { status: 'sent' },
        { status: 'sent' },
        { status: 'failed' },
      ]),
    },
    users: {
      findById: vi.fn().mockImplementation(async (id: string) => ({
        id,
        email: id === 'user_1' ? 'admin@example.com' : 'owner@example.com',
      })),
    },
  };
}
