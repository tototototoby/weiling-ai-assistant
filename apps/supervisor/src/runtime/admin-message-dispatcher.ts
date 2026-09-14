import type {
  AdminMessageDeliveryRepository,
  GlobalAdminMessageConfigRepository,
} from '@weiling-ai/db';

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BATCH_SIZE = 20;
const BASE_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 60_000;

export interface AdminMessageSender {
  sendAdminMessage(
    botInstanceId: string,
    deliveryId: string,
    text: string,
    semanticKey?: string,
  ): Promise<void>;
}

export interface AdminMessageDispatcherDependencies {
  botInstances: {
    findById(id: string): Promise<{ ownerUserId: string } | null>;
  };
  config: Pick<GlobalAdminMessageConfigRepository, 'ensure'>;
  deliveries: AdminMessageDeliveryRepository;
  imOnlySender?: AdminMessageSender;
  maxAttempts?: number;
  processManager: AdminMessageSender;
}

export class AdminMessageDispatcher implements AdminMessageSender {
  private readonly botInstances: AdminMessageDispatcherDependencies['botInstances'];
  private readonly config: Pick<GlobalAdminMessageConfigRepository, 'ensure'>;
  private readonly deliveries: AdminMessageDeliveryRepository;
  private readonly imOnlySender: AdminMessageSender | undefined;
  private readonly maxAttempts: number;
  private readonly processManager: AdminMessageSender;

  constructor(dependencies: AdminMessageDispatcherDependencies) {
    this.botInstances = dependencies.botInstances;
    this.config = dependencies.config;
    this.deliveries = dependencies.deliveries;
    this.imOnlySender = dependencies.imOnlySender;
    this.maxAttempts = dependencies.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.processManager = dependencies.processManager;
  }

  async sendAdminMessage(
    botInstanceId: string,
    deliveryId: string,
    text: string,
    semanticKey?: string,
  ): Promise<void> {
    const bot = await this.botInstances.findById(botInstanceId);
    if (!bot) throw new Error(`Bot not found: ${botInstanceId}`);

    const durableId = semanticKey ?? deliveryId;
    await this.deliveries.createBatch([{
      batchId: `scheduled:${durableId}`,
      botInstanceId,
      createdByUserId: bot.ownerUserId,
      id: durableId,
      message: text,
      recipientUserId: bot.ownerUserId,
    }]);
  }

  async runOnce(now: Date = new Date(), botInstanceId?: string): Promise<void> {
    const config = await this.config.ensure(now);
    if (!config.deferFailedUntilUserActive) {
      await this.deliveries.failWaiting(now);
    }
    const claimed = await this.deliveries.claimReady({
      ...(botInstanceId ? { botInstanceId } : {}),
      limit: DEFAULT_BATCH_SIZE,
      now,
      staleBefore: new Date(now.getTime() - 60_000),
    });

    await Promise.all(claimed.map(async (delivery) => {
      try {
        const sender = isImOnlyDelivery(delivery.metadata)
          ? this.imOnlySender ?? this.processManager
          : this.processManager;
        if (delivery.batchId === `scheduled:${delivery.id}`) {
          await sender.sendAdminMessage(
            delivery.botInstanceId,
            delivery.id,
            delivery.message,
            delivery.id,
          );
        } else {
          await sender.sendAdminMessage(
            delivery.botInstanceId,
            delivery.id,
            delivery.message,
          );
        }
        await this.deliveries.markSent(delivery.id, new Date());
      } catch (error) {
        const failedAt = new Date();
        await this.deliveries.markAttemptFailed({
          deferAfterMaxAttempts: config.deferFailedUntilUserActive,
          error: formatError(error),
          id: delivery.id,
          maxAttempts: this.maxAttempts,
          nextAttemptAt: new Date(
            failedAt.getTime() + getRetryDelayMs(delivery.attemptCount),
          ),
          updatedAt: failedAt,
        });
      }
    }));
  }

  async handleUserActive(botInstanceId: string, now: Date = new Date()): Promise<number> {
    const config = await this.config.ensure(now);
    if (!config.deferFailedUntilUserActive) return 0;

    const resumed = await this.deliveries.resumeWaitingForBot(botInstanceId, now);
    if (resumed > 0) await this.runOnce(now, botInstanceId);
    return resumed;
  }
}

export function getRetryDelayMs(attemptCount: number): number {
  return Math.min(
    BASE_RETRY_DELAY_MS * (2 ** Math.max(0, attemptCount - 1)),
    MAX_RETRY_DELAY_MS,
  );
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isImOnlyDelivery(metadata: string | null): boolean {
  if (!metadata) return false;
  try {
    const parsed = JSON.parse(metadata) as { channel?: unknown };
    return parsed.channel === 'im';
  } catch {
    return false;
  }
}
