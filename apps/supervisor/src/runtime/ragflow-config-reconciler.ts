import type {
  BotInstanceRepository,
  BotRagflowSyncRecord,
  BotRagflowSyncRepository,
  GlobalRagflowConfigRecord,
  GlobalRagflowConfigRepository,
} from '@weiling-ai/db';
import { ensureManagedMcpServer } from './dify-config-reconciler';

const ACTIVE_RUNTIME_STATUSES = new Set([
  'starting',
  'waiting_for_qr',
  'running',
  'degraded',
]);

type ConfigRepository = Pick<GlobalRagflowConfigRepository, 'ensure'>;
type SyncStateRepository = Pick<
  BotRagflowSyncRepository,
  'ensureForAllBots' | 'markSyncFailed' | 'markSyncSucceeded'
>;
type BotRepository = Pick<BotInstanceRepository, 'findById' | 'requestRestart'>;

export interface RagflowConfigReconcilerDependencies {
  botInstances: BotRepository;
  configRepository: ConfigRepository;
  instancesRoot: string;
  logError?: (error: unknown) => void;
  syncStateRepository: SyncStateRepository;
}

export class RagflowConfigReconciler {
  private isRunning = false;
  private readonly botInstances: BotRepository;
  private readonly configRepository: ConfigRepository;
  private readonly instancesRoot: string;
  private readonly logError: (error: unknown) => void;
  private readonly syncStateRepository: SyncStateRepository;

  constructor(dependencies: RagflowConfigReconcilerDependencies) {
    this.botInstances = dependencies.botInstances;
    this.configRepository = dependencies.configRepository;
    this.instancesRoot = dependencies.instancesRoot;
    this.logError = dependencies.logError ?? console.error;
    this.syncStateRepository = dependencies.syncStateRepository;
  }

  async runOnce(now: Date = new Date()): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const config = await this.configRepository.ensure(now);
      const states = await this.syncStateRepository.ensureForAllBots(now);

      for (const state of states) {
        await this.reconcileBot(state, config, now);
      }
    } finally {
      this.isRunning = false;
    }
  }

  private async reconcileBot(
    state: BotRagflowSyncRecord,
    config: GlobalRagflowConfigRecord,
    now: Date,
  ): Promise<void> {
    try {
      const settingsChanged = await ensureManagedMcpServer(this.instancesRoot, state.botInstanceId);
      const revisionChanged = state.appliedRevision !== config.revision
        || state.syncStatus !== 'synced'
        || state.lastSyncError !== null;

      if (!settingsChanged && !revisionChanged) return;

      await this.syncStateRepository.markSyncSucceeded(state.botInstanceId, config.revision, now);

      const bot = await this.botInstances.findById(state.botInstanceId);
      if (bot && bot.desiredState === 'running' && ACTIVE_RUNTIME_STATUSES.has(bot.status)) {
        await this.botInstances.requestRestart(bot.id, now);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      try {
        await this.syncStateRepository.markSyncFailed(state.botInstanceId, message, now);
      } catch (markError) {
        this.logError(markError);
      }

      this.logError(new Error(
        `Failed to publish managed RAGFlow MCP config to ${state.botInstanceId}: ${message}`,
      ));
    }
  }
}
