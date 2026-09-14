import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveBotInstancePaths } from '@weiling-ai/shared';
import type {
  BotInstanceRepository,
  ScheduledTaskRecoveryRepository,
} from '@weiling-ai/db';
import type { SupervisorConfig } from '../config';
import type { AdminMessageSender } from './admin-message-dispatcher';
import type { ProcessManager } from './process-manager';

const TASKS_FILE_RELATIVE_PATH = ['scheduled-tasks', 'im-gateway', 'tasks.jsonl'];

export interface ScheduledTaskRecoveryReconcilerDependencies {
  botInstances: Pick<BotInstanceRepository, 'listAllForAdministration'>;
  config: SupervisorConfig;
  messageSender: AdminMessageSender;
  recoveries: ScheduledTaskRecoveryRepository;
  processManager: Pick<ProcessManager, 'runExternalTurn'>;
  now?: () => Date;
}

interface RecoveryEvent {
  recovery?: {
    kind?: unknown;
    prompt?: unknown;
    recoveryId?: unknown;
    scheduledFor?: unknown;
    taskId?: unknown;
  };
  type?: unknown;
}

export class ScheduledTaskRecoveryReconciler {
  private readonly dependencies: ScheduledTaskRecoveryReconcilerDependencies;
  private readonly getNow: () => Date;

  constructor(dependencies: ScheduledTaskRecoveryReconcilerDependencies) {
    this.dependencies = dependencies;
    this.getNow = dependencies.now ?? (() => new Date());
  }

  async runOnce(): Promise<void> {
    const bots = await this.dependencies.botInstances.listAllForAdministration();

    for (const bot of bots) {
      await this.runBestEffort(
        () => this.reconcileBot(bot.id),
        `Failed to reconcile scheduled task recoveries for Bot ${bot.id}.`,
      );
    }
  }

  private async reconcileBot(botInstanceId: string): Promise<void> {
    const tasksFile = path.join(
      resolveBotInstancePaths(this.dependencies.config.instancesRoot, botInstanceId).dataDir,
      ...TASKS_FILE_RELATIVE_PATH,
    );
    let raw: string;
    try {
      raw = await readFile(tasksFile, 'utf8');
    } catch {
      return;
    }

    for (const line of raw.split('\n')) {
      const event = parseRecoveryEvent(line);
      if (!event?.recovery) continue;
      const recoveryId = normalizeText(event.recovery.recoveryId);
      const prompt = normalizeText(event.recovery.prompt);
      if (!recoveryId || !prompt) continue;

      const claim = await this.dependencies.recoveries.claim({
        botInstanceId,
        kind: normalizeText(event.recovery.kind) ?? 'missed_one_shot',
        prompt,
        recoveryId,
        scheduledFor: parseTimestamp(event.recovery.scheduledFor),
        taskId: normalizeText(event.recovery.taskId) ?? 'unknown',
      });
      if (claim !== 'claimed') continue;

      try {
        const deliveryId = `scheduled-recovery:${recoveryId}`;
        const reply = await this.dependencies.processManager.runExternalTurn(
          botInstanceId,
          deliveryId,
          prompt,
        );
        await this.dependencies.messageSender.sendAdminMessage(
          botInstanceId,
          deliveryId,
          reply,
          deliveryId,
        );
        await this.dependencies.recoveries.markDelivered(recoveryId, this.getNow());
        console.info(`Delivered missed scheduled task recovery ${recoveryId} for Bot ${botInstanceId}.`);
      } catch (error) {
        await this.runBestEffort(
          () => this.dependencies.recoveries.markFailed(recoveryId, formatError(error), this.getNow()),
          `Failed to persist scheduled task recovery failure for ${recoveryId}.`,
        );
        console.error(`Failed to deliver missed scheduled task recovery ${recoveryId} for Bot ${botInstanceId}.`);
        console.error(error);
      }
    }
  }

  private async runBestEffort(
    operation: () => Promise<unknown>,
    failureMessage: string,
  ): Promise<void> {
    try {
      await operation();
    } catch (error) {
      console.error(failureMessage);
      console.error(error);
    }
  }
}

function parseRecoveryEvent(line: string): RecoveryEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const event = parsed as RecoveryEvent;
    if (event.type !== 'recovery_created' || !event.recovery) return null;
    return event;
  } catch {
    return null;
  }
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return new Date(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
