import type {
  AdminMessageDeliveryRepository,
  BotEventRepository,
  DeliveryHealthCheckRepository,
  GlobalDeliveryHealthConfigRepository,
  GlobalEmailConfigRepository,
} from '@weiling-ai/db';
import type { GlobalEmailSender } from './global-email-sender';
import { getShanghaiDateTime } from './meal-reminder-scheduler';

const DAY_MS = 24 * 60 * 60 * 1000;
const ALERT_SUBJECT = '微Link · 微灵 AI 助手投递健康告警';

type DeliveryHealthConfigRepository = Pick<
  GlobalDeliveryHealthConfigRepository,
  'ensure' | 'find'
>;
type AdminMessageDeliveryRepositoryMethods = Pick<
  AdminMessageDeliveryRepository,
  'listStuckDelivering' | 'summarizeByStatus'
>;
type DeliveryHealthCheckRepositoryMethods = Pick<
  DeliveryHealthCheckRepository,
  'findByDate' | 'upsertByDate'
>;
type DeliveryHealthAlertSender = {
  sendAlertEmail(to: string, subject: string, text: string): Promise<void>;
};

export interface DeliveryHealthSchedulerDependencies {
  checks: DeliveryHealthCheckRepositoryMethods;
  configRepository: DeliveryHealthConfigRepository;
  deliveries: AdminMessageDeliveryRepositoryMethods;
  emailSender: DeliveryHealthAlertSender;
  now?: () => Date;
}

interface LegacyDeliveryHealthSchedulerDependencies {
  botEvents?: Pick<BotEventRepository, 'countByTypeBetween'>;
  config: DeliveryHealthConfigRepository;
  deliveries: AdminMessageDeliveryRepositoryMethods;
  emailConfig?: Pick<GlobalEmailConfigRepository, 'ensure'>;
  healthChecks: DeliveryHealthCheckRepositoryMethods;
  sender?: Pick<GlobalEmailSender, 'send'>;
}

export class DeliveryHealthScheduler {
  private readonly checksRepository: DeliveryHealthCheckRepositoryMethods;
  private readonly configRepository: DeliveryHealthConfigRepository;
  private readonly deliveries: AdminMessageDeliveryRepositoryMethods;
  private readonly emailSender: DeliveryHealthAlertSender | null;
  private readonly legacyEmailConfig: Pick<GlobalEmailConfigRepository, 'ensure'> | null;
  private readonly legacySender: Pick<GlobalEmailSender, 'send'> | null;
  private readonly nowProvider: (() => Date) | null;

  constructor(
    private readonly dependencies: DeliveryHealthSchedulerDependencies
      | LegacyDeliveryHealthSchedulerDependencies,
  ) {
    this.deliveries = dependencies.deliveries;
    this.configRepository = 'configRepository' in dependencies
      ? dependencies.configRepository
      : dependencies.config;
    this.checksRepository = 'checks' in dependencies
      ? dependencies.checks
      : dependencies.healthChecks;
    this.emailSender = 'emailSender' in dependencies
      ? dependencies.emailSender
      : null;
    this.legacyEmailConfig = 'emailConfig' in dependencies
      ? dependencies.emailConfig ?? null
      : null;
    this.legacySender = 'sender' in dependencies
      ? dependencies.sender ?? null
      : null;
    this.nowProvider = 'now' in dependencies
      ? dependencies.now ?? null
      : null;
  }

  async runOnce(now: Date = this.nowProvider?.() ?? new Date()) {
    const config = await this.configRepository.ensure(now);
    if (!config.enabled) return null;

    const todayDate = getShanghaiDateTime(now).date;
    const checkDate = getShanghaiDateTime(new Date(now.getTime() - DAY_MS)).date;
    const existing = await this.checksRepository.findByDate(checkDate);
    if (existing) {
      return {
        alert: existing.alertSent,
        checkDate,
        summaryJson: existing.summaryJson,
      };
    }

    const rangeStart = new Date(`${checkDate}T00:00:00+08:00`);
    const rangeEnd = new Date(`${todayDate}T00:00:00+08:00`);
    const [summary, stuck] = await Promise.all([
      this.deliveries.summarizeByStatus(rangeStart, rangeEnd),
      this.deliveries.listStuckDelivering(
        new Date(now.getTime() - config.stuckHours * 3600_000),
      ),
    ]);

    const failedCount = summary.failed ?? 0;
    const stuckCount = stuck.length;
    const alert = failedCount > config.failedThreshold || stuckCount > 0;
    const summaryJson = JSON.stringify({
      alert,
      checkDate,
      failedCount,
      failedThreshold: config.failedThreshold,
      stuckCount,
    });

    if (alert && config.alertEmail?.trim()) {
      try {
        await this.sendAlertEmail(
          config.alertEmail.trim(),
          buildAlertText({
            alert,
            checkDate,
            failedCount,
            failedThreshold: config.failedThreshold,
            stuckCount,
          }),
          now,
        );
      } catch (error) {
        console.error('Delivery health alert email failed.');
        console.error(error);
      }
    }

    await this.checksRepository.upsertByDate({
      alertSent: alert,
      checkDate,
      id: `dhc:${checkDate}`,
      summaryJson,
    });

    return {
      alert,
      checkDate,
      summaryJson,
    };
  }

  private async sendAlertEmail(
    to: string,
    text: string,
    now: Date,
  ): Promise<void> {
    if (this.emailSender) {
      await this.emailSender.sendAlertEmail(to, ALERT_SUBJECT, text);
      return;
    }

    if (!this.legacyEmailConfig || !this.legacySender) return;
    const emailConfig = await this.legacyEmailConfig.ensure(now);
    if (!emailConfig.enabled || !emailConfig.senderEmail) return;
    await this.legacySender.send(emailConfig, {
      message: text,
      recipientEmail: to,
      subject: ALERT_SUBJECT,
    });
  }
}

function buildAlertText(summary: {
  alert: boolean;
  checkDate: string;
  failedCount: number;
  failedThreshold: number;
  stuckCount: number;
}): string {
  const lines = [
    `${summary.checkDate} 投递健康检查发现异常：`,
    '',
    `- 失败消息：${summary.failedCount} 条`,
    `- 失败阈值：${summary.failedThreshold} 条`,
    `- 卡住（delivering 超时）：${summary.stuckCount} 条`,
    '',
    '请登录管理后台查看投递明细，并检查微信/企业微信通道状态。',
  ];
  return lines.join('\n');
}
