import { z } from 'zod';
import { ApiError } from './api-error';
import { getRepositories, type WebRepositories } from './repositories';

const reportDaysSchema = z.union([z.literal(7), z.literal(30)]);

export type ReportDays = 7 | 30;

export interface ActivityReportItem {
  botInstanceId: string;
  botName: string;
  ownerUserId: string;
  ownerEmail: string | null;
  inbound: number;
  outbound: number;
}

export interface DeliveryFailureItem {
  id: string;
  batchId: string;
  botInstanceId: string;
  botName: string;
  recipientUserId: string;
  status: string;
  lastError: string | null;
  message: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminReportsPayload {
  days: ReportDays;
  activity: ActivityReportItem[];
  delivery: {
    totalsByStatus: Record<string, number>;
    recentFailures: DeliveryFailureItem[];
  };
  email: {
    sent: number;
    failed: number;
    total: number;
  };
}

const ADMIN_REPORT_DELIVERY_LIMIT = 1_000;
const ADMIN_REPORT_EMAIL_LIMIT = 1_000;

export async function getAdminReports(
  daysValue: unknown,
  repositories: WebRepositories = getRepositories(),
): Promise<AdminReportsPayload> {
  const parsed = reportDaysSchema.safeParse(daysValue);
  if (!parsed.success) {
    throw new ApiError({
      code: 'VALIDATION_ERROR',
      message: 'days must be 7 or 30.',
      status: 400,
    });
  }
  const days = parsed.data;
  const today = new Date();
  const fromDate = toDateKey(addDays(today, -days));
  const toDate = toDateKey(today);

  const [activityRows, bots, adminRecords, emailRecords] = await Promise.all([
    repositories.botDailyActivity.sumRange(fromDate, toDate),
    repositories.botInstances.listAllForAdministration(),
    repositories.adminMessageDeliveries.listRecent(ADMIN_REPORT_DELIVERY_LIMIT),
    repositories.emailDeliveries.listRecent(ADMIN_REPORT_EMAIL_LIMIT),
  ]);
  const ownerIds = Array.from(new Set(bots.map((bot) => bot.ownerUserId)));
  const owners = await Promise.all(ownerIds.map((id) => repositories.users.findById(id)));
  const ownerEmailById = new Map(
    ownerIds.map((id, index) => [id, owners[index]?.email ?? null]),
  );
  const botById = new Map(bots.map((bot) => [bot.id, bot]));
  const activityByBotId = new Map(
    activityRows.map((row) => [row.botInstanceId, row]),
  );

  const totalsByStatus: Record<string, number> = {};
  for (const record of adminRecords) {
    totalsByStatus[record.status] = (totalsByStatus[record.status] ?? 0) + 1;
  }

  const recentFailures = adminRecords
    .filter((record) => record.status === 'failed' || record.status === 'waiting_for_user')
    .slice(0, 50)
    .map((record) => ({
      id: record.id,
      batchId: record.batchId,
      botInstanceId: record.botInstanceId,
      botName: botById.get(record.botInstanceId)?.name ?? record.botInstanceId,
      recipientUserId: record.recipientUserId,
      status: record.status,
      lastError: record.lastError,
      message: record.message,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    }));

  const emailCounts = emailRecords.reduce(
    (counts, record) => {
      counts.total += 1;
      if (record.status === 'sent') counts.sent += 1;
      if (record.status === 'failed') counts.failed += 1;
      return counts;
    },
    { sent: 0, failed: 0, total: 0 },
  );

  return {
    days,
    activity: bots.map((bot) => {
      const row = activityByBotId.get(bot.id);
      return {
        botInstanceId: bot.id,
        botName: bot.name,
        ownerUserId: bot.ownerUserId,
        ownerEmail: ownerEmailById.get(bot.ownerUserId) ?? null,
        inbound: row?.inboundCount ?? 0,
        outbound: row?.outboundCount ?? 0,
      };
    }),
    delivery: {
      totalsByStatus,
      recentFailures,
    },
    email: emailCounts,
  };
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
