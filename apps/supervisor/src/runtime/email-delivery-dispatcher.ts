import type { EmailDeliveryRepository, GlobalEmailConfigRepository } from '@weiling-ai/db';
import type { GlobalEmailSender } from './global-email-sender';

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;
const BASE_RETRY_DELAY_MS = 10_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;

export interface EmailDeliveryDispatcherDependencies {
  config: Pick<GlobalEmailConfigRepository, 'ensure' | 'recordObservedRevision'>;
  deliveries: Pick<EmailDeliveryRepository, 'claimReady' | 'markSent' | 'markAttemptFailed'>;
  sender: Pick<GlobalEmailSender, 'send'>;
  workspaceRoot?: string;
}

export class EmailDeliveryDispatcher {
  constructor(private readonly dependencies: EmailDeliveryDispatcherDependencies) {}

  async runOnce(now: Date = new Date()): Promise<void> {
    const config = await this.dependencies.config.ensure(now);
    if (!config.enabled || !config.senderEmail) return;
    const claimed = await this.dependencies.deliveries.claimReady({
      limit: BATCH_SIZE,
      now,
      staleBefore: new Date(now.getTime() - 60_000),
    });
    await Promise.all(claimed.map(async (delivery) => {
      try {
        await this.dependencies.sender.send(config, delivery);
        await this.dependencies.deliveries.markSent(delivery.id, new Date());
      } catch (error) {
        const failedAt = new Date();
        await this.dependencies.deliveries.markAttemptFailed({
          error: formatError(error),
          id: delivery.id,
          maxAttempts: MAX_ATTEMPTS,
          nextAttemptAt: new Date(failedAt.getTime() + getRetryDelayMs(delivery.attemptCount)),
          updatedAt: failedAt,
        });
      }
    }));
    await this.dependencies.config.recordObservedRevision(config.revision);
  }
}

export function getRetryDelayMs(attemptCount: number): number {
  return Math.min(BASE_RETRY_DELAY_MS * (2 ** Math.max(0, attemptCount - 1)), MAX_RETRY_DELAY_MS);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
