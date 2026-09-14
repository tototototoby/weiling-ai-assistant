import { join } from 'node:path';
import type {
  BotEventRepository,
  BotInstanceRepository,
  BotDailyActivityRepository,
  BotSandboxRuntimePoolRepository,
  GlobalDifyConfigRepository,
  GlobalRagflowConfigRepository,
  UserLlmProfileRepository,
} from '@weiling-ai/db';
import type { ChildProcess } from 'node:child_process';
import {
  resolveManagedSkillsBundleRoot,
  syncManagedSkills,
} from '@weiling-ai/shared/managed-skills';
import type { SupervisorConfig } from '../config';
import { applyFastAgentEvent } from './event-applier';
import { createFastAgentEventReader } from './event-reader';
import { clearBotLoginState } from './clear-bot-login-state';
import { ensureQwenVisionSecret } from './qwen-vision-provisioner';
import { ProcessRegistry, type ManagedProcessEntry } from './process-registry';
import {
  renderAdminMessageCopy,
  type AdminMessageCopyProvider,
} from './admin-message-copy';
import {
  spawnFastAgentProcess,
  type MockFastAgentScenario,
  type ResolvedSandboxRuntimePool,
  type SpawnableBotInstance,
} from './spawn-fastagent';
import { getShanghaiDateTime } from './meal-reminder-scheduler';
import {
  LlmProfileInvalidError,
  LlmProfileRequiredError,
  resolveFastAgentRuntimeConfig,
} from './resolve-fastagent-runtime-config';

const FASTAGENT_START_FAILED_ERROR_CODE = 'FASTAGENT_START_FAILED';
const FASTAGENT_START_FAILED_ERROR_MESSAGE = 'FastAgent runtime could not be started.';
const SRT_POOL_DISABLED_ERROR_CODE = 'SRT_POOL_DISABLED';
const SRT_POOL_DISABLED_ERROR_MESSAGE = 'Sandbox runtime pool is disabled for this Bot.';
const MAX_EXTERNAL_TURN_DENIED_TOOLS = 32;
const SAFE_EXTERNAL_TURN_TOOL_NAME_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,127}$/u;
const TERMINATION_GRACE_MS = 1_000;

export interface StartInstanceOptions {
  mockScenario?: MockFastAgentScenario;
  stepDelayMs?: number;
}

export interface ProcessManagerDependencies {
  botDailyActivity?: BotDailyActivityRepository;
  botEvents: BotEventRepository;
  botInstances: BotInstanceRepository;
  config: SupervisorConfig;
  globalDifyConfigs?: Pick<GlobalDifyConfigRepository, 'find'>;
  globalRagflowConfigs?: Pick<GlobalRagflowConfigRepository, 'find'>;
  messageCopy?: AdminMessageCopyProvider;
  onUserActive?: (botInstanceId: string) => Promise<unknown> | unknown;
  userLlmProfiles: UserLlmProfileRepository;
  botSandboxRuntimePools: BotSandboxRuntimePoolRepository;
  registry?: ProcessRegistry;
  resolveEnabledManagedSkillNames?: () => Promise<readonly string[]>;
}

interface AdminMessageResult {
  deliveryId: string;
  error?: string;
  ok: boolean;
  type: 'weclaws_admin_message_result';
}

interface PendingAdminMessage {
  botInstanceId: string;
  reject: (error: Error) => void;
  resolve: () => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface ExternalTurnResult {
  error?: string;
  ok: boolean;
  requestId: string;
  sessionId?: string;
  text?: string;
  type: 'weclaws_external_turn_result';
}

interface ExternalTurnEvent {
  event: unknown;
  requestId: string;
  type: 'weclaws_external_turn_event';
}

interface UserActiveMessage {
  type: 'weclaws_user_active';
}

export interface ExternalTurnOptions {
  denyTools?: string[];
  onEvent?: (event: unknown) => void;
  sessionId?: string;
  sessionKey?: string;
  systemPrompt?: string;
  timeoutMs?: number;
}

export interface ExternalTurnResolved {
  sessionId?: string;
  text: string;
}

interface PendingExternalTurn {
  botInstanceId: string;
  onEvent?: (event: unknown) => void;
  reject: (error: Error) => void;
  resolve: (result: ExternalTurnResolved) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class ProcessManager {
  private readonly botDailyActivity: BotDailyActivityRepository | null;
  private readonly botEvents: BotEventRepository;
  private readonly botInstances: BotInstanceRepository;
  private readonly config: SupervisorConfig;
  private readonly globalDifyConfigs: Pick<GlobalDifyConfigRepository, 'find'> | null;
  private readonly globalRagflowConfigs: Pick<GlobalRagflowConfigRepository, 'find'> | null;
  private readonly messageCopy: AdminMessageCopyProvider | null;
  private readonly onUserActive: ((botInstanceId: string) => Promise<unknown> | unknown) | null;
  private readonly pendingAdminMessages = new Map<string, PendingAdminMessage>();
  private readonly pendingExternalTurns = new Map<string, PendingExternalTurn>();
  private readonly registry: ProcessRegistry;
  private readonly resolveEnabledManagedSkillNames: (() => Promise<readonly string[]>) | null;
  private readonly userLlmProfiles: UserLlmProfileRepository;
  private readonly botSandboxRuntimePools: BotSandboxRuntimePoolRepository;

  constructor(dependencies: ProcessManagerDependencies) {
    this.botDailyActivity = dependencies.botDailyActivity ?? null;
    this.botEvents = dependencies.botEvents;
    this.botInstances = dependencies.botInstances;
    this.config = dependencies.config;
    this.globalDifyConfigs = dependencies.globalDifyConfigs ?? null;
    this.globalRagflowConfigs = dependencies.globalRagflowConfigs ?? null;
    this.messageCopy = dependencies.messageCopy ?? null;
    this.onUserActive = dependencies.onUserActive ?? null;
    this.registry = dependencies.registry ?? new ProcessRegistry();
    this.resolveEnabledManagedSkillNames = dependencies.resolveEnabledManagedSkillNames ?? null;
    this.userLlmProfiles = dependencies.userLlmProfiles;
    this.botSandboxRuntimePools = dependencies.botSandboxRuntimePools;
  }

  hasInstance(botInstanceId: string) {
    return this.registry.has(botInstanceId);
  }

  async clearInstanceLoginState(botInstanceId: string) {
    await clearBotLoginState({
      botInstanceId,
      instancesRoot: this.config.instancesRoot,
    });
  }

  async startInstance(botInstance: SpawnableBotInstance, options: StartInstanceOptions = {}) {
    if (this.registry.has(botInstance.id)) {
      return false;
    }

    const runtimeConfig = await this.resolveRuntimeConfigOrFail(botInstance);

    if (!runtimeConfig) {
      return false;
    }

    const sandboxRuntimePool = await this.resolveSandboxRuntimePoolOrFail(botInstance);

    if (sandboxRuntimePool === null) {
      return false;
    }

    await this.botInstances.recordRuntimeConfigSnapshot(botInstance.id, {
      model: runtimeConfig.model,
      provider: runtimeConfig.provider,
      recordedAt: new Date(),
    });
    await ensureQwenVisionSecret(
      this.config.instancesRoot,
      botInstance.id,
      process.env.WEILING_QWEN_API_KEY?.trim() || process.env.WECLAWS_QWEN_API_KEY?.trim(),
    );
    await this.trySyncManagedSkills(botInstance.id);

    let child: ChildProcess;

    try {
      const difyConfig = await this.resolveDifyRuntimeConfig();
      const ragflowConfig = await this.resolveRagflowRuntimeConfig();
      child = await spawnFastAgentProcess({
        botInstance,
        config: this.config,
        difyConfig,
        mockScenario: options.mockScenario,
        ragflowConfig,
        runtimeConfig,
        sandboxRuntimePool,
        stepDelayMs: options.stepDelayMs,
      });
    } catch (error) {
      await this.handleStartInstanceFailure(botInstance.id, error);
      return false;
    }

    const entry = {
      applyChain: Promise.resolve(),
      botInstanceId: botInstance.id,
      child,
      fatalRuntimeFailureHandled: false,
      forceKillTimer: null,
      terminalStoppedHandled: false,
      terminationRequested: false,
    };

    const queueEvent = (event: Parameters<typeof applyFastAgentEvent>[1]['event']) => {
      entry.applyChain = entry.applyChain
        .then(async () => {
          if (entry.terminalStoppedHandled) {
            return;
          }

          if (
            entry.fatalRuntimeFailureHandled
            && event.type !== 'stopped'
            && event.type !== 'stopping'
          ) {
            return;
          }

          await applyFastAgentEvent(
            {
              botEvents: this.botEvents,
              botInstances: this.botInstances,
            },
            {
              botInstanceId: botInstance.id,
              event,
            },
          );

          if (event.type === 'stopped') {
            entry.terminalStoppedHandled = true;
            this.rejectPendingAdminMessagesForBot(
              entry.botInstanceId,
              new Error('Bot runtime stopped before admin message delivery completed.'),
            );
            this.rejectPendingExternalTurnsForBot(
              entry.botInstanceId,
              new Error('Bot runtime stopped before the external turn completed.'),
            );
            this.requestTermination(entry);
          }
        })
        .catch((error: unknown) => {
          return this.handleFatalRuntimeFailure(
            entry,
            'FastAgent event application failed.',
            error,
          );
        });
    };

    const reader = createFastAgentEventReader({
      onEvent: queueEvent,
      onInvalidLine: ({ error, line }) => {
        console.error(`Invalid FastAgent line for ${botInstance.id}: ${line}`);
        entry.applyChain = entry.applyChain
          .then(() => this.handleFatalRuntimeFailure(
            entry,
            'FastAgent emitted invalid JSONL output.',
            error,
          ))
          .catch((chainError: unknown) => {
            console.error(chainError);
            return this.handleFatalRuntimeFailure(
              entry,
              'FastAgent emitted invalid JSONL output.',
              error,
            );
          });
      },
    });

    this.attachProcessListeners(botInstance.id, child, entry, reader);
    this.registry.add(entry);
    void this.syncMessageCopyToChild(child);

    return true;
  }

  async syncMessageCopy(): Promise<void> {
    if (!this.messageCopy) return;
    const copy = await this.messageCopy.getCopy();
    await Promise.all(this.registry.values().map((entry) => this.syncMessageCopyToChild(
      entry.child,
      copy,
    )));
  }

  async stopInstance(botInstanceId: string) {
    const entry = this.registry.get(botInstanceId);

    if (!entry) {
      return false;
    }

    if (hasChildExited(entry.child)) {
      this.releaseEntryWhenApplied(entry);
      return false;
    }

    this.requestTermination(entry);
    return true;
  }

  async sendAdminMessage(
    botInstanceId: string,
    deliveryId: string,
    text: string,
    semanticKey?: string,
    timeoutMs = 15_000,
  ): Promise<void> {
    const entry = this.registry.get(botInstanceId);
    const normalizedText = text.trim();

    if (!entry || hasChildExited(entry.child) || entry.terminationRequested) {
      throw new Error('Bot process is not running.');
    }

    if (!normalizedText) {
      throw new Error('Admin message cannot be empty.');
    }

    if (!deliveryId.trim()) {
      throw new Error('Admin message delivery ID is required.');
    }

    if (typeof entry.child.send !== 'function' || entry.child.connected === false) {
      throw new Error('Bot process IPC channel is unavailable.');
    }

    const pendingKey = this.createAdminMessagePendingKey(botInstanceId, deliveryId);

    if (this.pendingAdminMessages.has(pendingKey)) {
      throw new Error('Admin message delivery is already in progress.');
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingAdminMessages.delete(pendingKey);
        reject(new Error('FastAgent admin message delivery timed out.'));
      }, timeoutMs);

      this.pendingAdminMessages.set(pendingKey, {
        botInstanceId,
        reject,
        resolve,
        timeout,
      });

      try {
        entry.child.send?.({
          deliveryId,
          semanticKey,
          text: normalizedText,
          type: 'weclaws_admin_message',
        }, (error) => {
          if (!error) return;
          this.rejectPendingAdminMessage(pendingKey, error);
        });
      } catch (error) {
        this.rejectPendingAdminMessage(
          pendingKey,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });
  }

  async runExternalTurn(
    botInstanceId: string,
    requestId: string,
    text: string,
    options: number | ExternalTurnOptions = {},
  ): Promise<string> {
    return (await this.startExternalTurn(botInstanceId, requestId, text, options)).text;
  }

  async runExternalTurnDetailed(
    botInstanceId: string,
    requestId: string,
    text: string,
    options: number | ExternalTurnOptions = {},
  ): Promise<ExternalTurnResolved> {
    return this.startExternalTurn(botInstanceId, requestId, text, options);
  }

  private async startExternalTurn(
    botInstanceId: string,
    requestId: string,
    text: string,
    options: number | ExternalTurnOptions = {},
  ): Promise<ExternalTurnResolved> {
    const entry = this.registry.get(botInstanceId);
    const normalizedRequestId = requestId.trim();
    const normalizedText = text.trim();
    const resolvedOptions = typeof options === 'number' ? { timeoutMs: options } : options;
    const denyTools = normalizeExternalTurnDenyTools(resolvedOptions.denyTools);
    const timeoutMs = resolvedOptions.timeoutMs ?? 5 * 60_000;
    const onEvent = resolvedOptions.onEvent;
    const sessionId = resolvedOptions.sessionId?.trim() || undefined;
    const sessionKey = resolvedOptions.sessionKey?.trim() || undefined;
    const systemPrompt = resolvedOptions.systemPrompt?.trim() || undefined;

    if (!entry || hasChildExited(entry.child) || entry.terminationRequested) {
      throw new Error('Bot process is not running.');
    }
    if (!normalizedRequestId) throw new Error('External turn request ID is required.');
    if (!normalizedText) throw new Error('External turn text cannot be empty.');
    if (Buffer.byteLength(normalizedText, 'utf8') > 64 * 1024) {
      throw new Error('External turn text is too large.');
    }
    if (typeof entry.child.send !== 'function' || entry.child.connected === false) {
      throw new Error('Bot process IPC channel is unavailable.');
    }

    const pendingKey = this.createExternalTurnPendingKey(botInstanceId, normalizedRequestId);
    if (this.pendingExternalTurns.has(pendingKey)) {
      throw new Error('External turn is already in progress.');
    }

    return new Promise<ExternalTurnResolved>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingExternalTurns.delete(pendingKey);
        reject(new Error('FastAgent external turn timed out.'));
      }, timeoutMs);

      this.pendingExternalTurns.set(pendingKey, {
        botInstanceId,
        onEvent,
        reject,
        resolve,
        timeout,
      });

      try {
        entry.child.send?.({
          ...(denyTools ? { denyTools } : {}),
          forwardEvents: Boolean(onEvent),
          requestId: normalizedRequestId,
          sessionId,
          sessionKey,
          systemPrompt,
          text: normalizedText,
          type: 'weclaws_external_turn',
        }, (error) => {
          if (!error) return;
          this.rejectPendingExternalTurn(pendingKey, error);
        });
      } catch (error) {
        this.rejectPendingExternalTurn(
          pendingKey,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });
  }

  assertCanRunExternalTurn(botInstanceId: string, requestId: string): void {
    const entry = this.registry.get(botInstanceId);
    const normalizedRequestId = requestId.trim();

    if (!entry || hasChildExited(entry.child) || entry.terminationRequested) {
      throw new Error('Bot process is not running.');
    }
    if (!normalizedRequestId) throw new Error('External turn request ID is required.');
    if (typeof entry.child.send !== 'function' || entry.child.connected === false) {
      throw new Error('Bot process IPC channel is unavailable.');
    }
    if (this.pendingExternalTurns.has(this.createExternalTurnPendingKey(botInstanceId, normalizedRequestId))) {
      throw new Error('External turn is already in progress.');
    }
  }

  async dispose() {
    const activeEntries = this.registry.values();
    const exitWaits: Array<Promise<void>> = [];

    for (const entry of activeEntries) {
      this.clearForceKillTimer(entry);
      entry.child.removeAllListeners();
      entry.child.stdout?.removeAllListeners();
      entry.child.stderr?.removeAllListeners();

      if (!hasChildExited(entry.child)) {
        exitWaits.push(waitForChildExitDuringDispose(entry.child));
      }

      this.rejectPendingAdminMessagesForBot(
        entry.botInstanceId,
        new Error('Bot process stopped before admin message delivery completed.'),
      );
      this.rejectPendingExternalTurnsForBot(
        entry.botInstanceId,
        new Error('Bot process stopped before the external turn completed.'),
      );

      if (!hasChildExited(entry.child)) {
        entry.child.kill('SIGKILL');
      }

      this.registry.deleteIfCurrent(entry);
    }

    await Promise.all(exitWaits);
  }

  private attachProcessListeners(
    botInstanceId: string,
    child: ChildProcess,
    entry: ManagedProcessEntry,
    reader: ReturnType<typeof createFastAgentEventReader>,
  ) {
    child.stdout?.on('data', (chunk: Buffer | string) => {
      reader.push(chunk);
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      console.error(`FastAgent stderr [${botInstanceId}]: ${chunk.toString().trim()}`);
    });

    child.on('message', (message: unknown) => {
      this.handleAdminMessageResult(botInstanceId, message);
      this.handleExternalTurnEvent(botInstanceId, message);
      this.handleExternalTurnResult(botInstanceId, message);
      this.handleUserActiveMessage(botInstanceId, message);
    });

    child.once('exit', () => {
      this.clearForceKillTimer(entry);
    });

    child.once('close', () => {
      reader.flush();
      this.rejectPendingAdminMessagesForBot(
        botInstanceId,
        new Error('Bot process exited before admin message delivery completed.'),
      );
      this.rejectPendingExternalTurnsForBot(
        botInstanceId,
        new Error('Bot process exited before the external turn completed.'),
      );
      this.releaseEntryWhenApplied(entry);
    });

    child.once('error', (error) => {
      console.error(`FastAgent child error [${botInstanceId}]`);
      console.error(error);
      this.rejectPendingAdminMessagesForBot(botInstanceId, error);
      this.rejectPendingExternalTurnsForBot(botInstanceId, error);
    });
  }

  private handleAdminMessageResult(botInstanceId: string, message: unknown) {
    if (!isAdminMessageResult(message)) return;
    const pendingKey = this.createAdminMessagePendingKey(botInstanceId, message.deliveryId);
    const pending = this.pendingAdminMessages.get(pendingKey);

    if (!pending) return;
    this.pendingAdminMessages.delete(pendingKey);
    clearTimeout(pending.timeout);

    if (message.ok) {
      pending.resolve();
      return;
    }

    pending.reject(new Error(message.error?.trim() || 'FastAgent admin message delivery failed.'));
  }

  private handleUserActiveMessage(botInstanceId: string, message: unknown) {
    if (!isUserActiveMessage(message)) return;

    void Promise.resolve()
      .then(() => this.onUserActive?.(botInstanceId))
      .catch((error: unknown) => {
        console.error(`Failed to resume deferred messages for Bot ${botInstanceId}.`);
        console.error(error);
      });
    void Promise.resolve()
      .then(async () => {
        if (!this.botDailyActivity) return;
        await this.botDailyActivity.incrementInbound(
          botInstanceId,
          getShanghaiDateTime(new Date()).date,
        );
      })
      .catch((error: unknown) => {
        console.error(`Failed to record daily activity for Bot ${botInstanceId}.`);
        console.error(error);
      });
  }

  private rejectPendingAdminMessage(pendingKey: string, error: Error) {
    const pending = this.pendingAdminMessages.get(pendingKey);
    if (!pending) return;
    this.pendingAdminMessages.delete(pendingKey);
    clearTimeout(pending.timeout);
    pending.reject(error);
  }

  private rejectPendingAdminMessagesForBot(botInstanceId: string, error: Error) {
    for (const [pendingKey, pending] of this.pendingAdminMessages) {
      if (pending.botInstanceId === botInstanceId) {
        this.rejectPendingAdminMessage(pendingKey, error);
      }
    }
  }

  private handleExternalTurnResult(botInstanceId: string, message: unknown) {
    if (!isExternalTurnResult(message)) return;
    const pendingKey = this.createExternalTurnPendingKey(botInstanceId, message.requestId);
    const pending = this.pendingExternalTurns.get(pendingKey);
    if (!pending) return;

    this.pendingExternalTurns.delete(pendingKey);
    clearTimeout(pending.timeout);
    if (message.ok && message.text?.trim()) {
      pending.resolve({
        sessionId: message.sessionId,
        text: message.text,
      });
      return;
    }
    pending.reject(new Error(
      message.error?.trim()
      || (message.ok ? 'FastAgent external turn returned an empty reply.' : 'FastAgent external turn failed.'),
    ));
  }

  private handleExternalTurnEvent(botInstanceId: string, message: unknown) {
    if (!isExternalTurnEvent(message)) return;
    const pendingKey = this.createExternalTurnPendingKey(botInstanceId, message.requestId);
    const pending = this.pendingExternalTurns.get(pendingKey);
    if (!pending?.onEvent) return;
    try {
      pending.onEvent(message.event);
    } catch (error) {
      console.error(`External turn event callback failed for Bot ${botInstanceId}.`);
      console.error(error);
    }
  }

  private rejectPendingExternalTurn(pendingKey: string, error: Error) {
    const pending = this.pendingExternalTurns.get(pendingKey);
    if (!pending) return;
    this.pendingExternalTurns.delete(pendingKey);
    clearTimeout(pending.timeout);
    pending.reject(error);
  }

  private rejectPendingExternalTurnsForBot(botInstanceId: string, error: Error) {
    for (const [pendingKey, pending] of this.pendingExternalTurns) {
      if (pending.botInstanceId === botInstanceId) {
        this.rejectPendingExternalTurn(pendingKey, error);
      }
    }
  }

  private createAdminMessagePendingKey(botInstanceId: string, deliveryId: string) {
    return `${botInstanceId}\u0000${deliveryId}`;
  }

  private async syncMessageCopyToChild(
    child: ChildProcess,
    messageCopy?: Awaited<ReturnType<AdminMessageCopyProvider['getCopy']>>,
  ): Promise<void> {
    if (!this.messageCopy || typeof child.send !== 'function' || child.connected === false) return;
    const copy = messageCopy ?? await this.messageCopy.getCopy();
    const assistantName = copy.assistantName.trim();
    const processingAck = renderAdminMessageCopy(copy.processingAck, {
      assistantName,
    }).trim();
    if (!assistantName || !processingAck) return;
    try {
      child.send({
        type: 'weclaws_message_copy',
        assistantName,
        processingAck,
      });
    } catch (error) {
      console.error('Failed to update FastAgent message copy.');
      console.error(error);
    }
  }

  private createExternalTurnPendingKey(botInstanceId: string, requestId: string) {
    return `${botInstanceId}\u0000${requestId}`;
  }

  private releaseEntryWhenApplied(entry: ManagedProcessEntry) {
    void entry.applyChain.finally(() => {
      this.registry.deleteIfCurrent(entry);
    });
  }

  private requestTermination(entry: ManagedProcessEntry) {
    if (hasChildExited(entry.child)) {
      return;
    }

    if (!entry.terminationRequested) {
      entry.terminationRequested = true;
      entry.child.kill('SIGTERM');
    }

    if (entry.forceKillTimer) {
      return;
    }

    entry.forceKillTimer = setTimeout(() => {
      entry.forceKillTimer = null;

      if (this.registry.get(entry.botInstanceId) !== entry || hasChildExited(entry.child)) {
        return;
      }

      entry.child.kill('SIGKILL');
    }, TERMINATION_GRACE_MS);
    entry.forceKillTimer.unref();
  }

  private clearForceKillTimer(entry: ManagedProcessEntry) {
    if (!entry.forceKillTimer) {
      return;
    }

    clearTimeout(entry.forceKillTimer);
    entry.forceKillTimer = null;
  }

  private async handleFatalRuntimeFailure(
    entry: ManagedProcessEntry,
    message: string,
    error: unknown,
  ) {
    if (entry.fatalRuntimeFailureHandled) {
      return;
    }

    entry.fatalRuntimeFailureHandled = true;
    console.error(`${message} [${entry.botInstanceId}]`);
    console.error(error);

    try {
      await this.botInstances.recordRuntimeError(entry.botInstanceId, {
        errorCode: 'RUNTIME_ERROR',
        errorMessage: message,
        observedAt: new Date(),
      });
    } catch (recordError) {
      console.error(`Failed to persist runtime error for ${entry.botInstanceId}`);
      console.error(recordError);
    }

    this.requestTermination(entry);
  }

  private async trySyncManagedSkills(botInstanceId: string) {
    try {
      const enabledSkillNames = this.resolveEnabledManagedSkillNames
        ? await this.resolveEnabledManagedSkillNames()
        : undefined;
      const result = await syncManagedSkills({
        botInstanceId,
        bundleRoot: resolveManagedSkillsBundleRoot(this.config.workspaceRoot),
        enabledSkillNames,
        instancesRoot: this.config.instancesRoot,
        operation: {
          type: 'sync-all-managed',
        },
      });

      if (result.status === 'busy') {
        console.warn(`Managed skills sync already in progress for ${botInstanceId}. Skipping this attempt.`);
        return;
      }

      if (result.status === 'error') {
        console.error(`Managed skills sync failed for ${botInstanceId}. Continuing startup.`);

        for (const error of result.errors) {
          console.error(error);
        }
      }
    } catch (error) {
      console.error(`Managed skills sync threw for ${botInstanceId}. Continuing startup.`);
      console.error(error);
    }
  }

  private async handleStartInstanceFailure(botInstanceId: string, error: unknown) {
    console.error(`FastAgent startup failed [${botInstanceId}]`);
    console.error(error);

    await this.botInstances.markFailed(botInstanceId, {
      errorCode: FASTAGENT_START_FAILED_ERROR_CODE,
      errorMessage: FASTAGENT_START_FAILED_ERROR_MESSAGE,
      failedAt: new Date(),
      restartCount: 0,
    });
  }

  private async resolveRuntimeConfigOrFail(botInstance: SpawnableBotInstance) {
    try {
      return await resolveFastAgentRuntimeConfig({
        botInstance,
        userLlmProfiles: this.userLlmProfiles,
      });
    } catch (error) {
      if (!(error instanceof LlmProfileRequiredError) && !(error instanceof LlmProfileInvalidError)) {
        throw error;
      }

      await this.botInstances.markFailed(botInstance.id, {
        errorCode: error.code,
        errorMessage: error.message,
        failedAt: new Date(),
        restartCount: 0,
      });

      return null;
    }
  }

  private async resolveSandboxRuntimePoolOrFail(
    botInstance: SpawnableBotInstance,
  ): Promise<ResolvedSandboxRuntimePool | null | undefined> {
    if (this.config.sandboxMode === 'disabled') {
      return undefined;
    }

    if (!this.config.srtPoolDefaults || !this.config.srtServiceHost || !this.config.srtWorkspaceMapDir) {
      throw new Error('Remote sandbox mode requires SRT pool defaults, service host, and workspace map directory.');
    }

    const pool = await this.botSandboxRuntimePools.ensureForBot({
      botInstanceId: botInstance.id,
      defaults: this.config.srtPoolDefaults,
    });

    if (!pool.enabled) {
      await this.botInstances.markFailed(botInstance.id, {
        errorCode: SRT_POOL_DISABLED_ERROR_CODE,
        errorMessage: SRT_POOL_DISABLED_ERROR_MESSAGE,
        failedAt: new Date(),
        restartCount: 0,
      });

      return null;
    }

    return {
      apiKey: pool.apiKey,
      url: `http://${this.config.srtServiceHost}:${pool.port}`,
      workspaceMapFile: join(this.config.srtWorkspaceMapDir, `${pool.botInstanceId}.json`),
    };
  }

  private async resolveDifyRuntimeConfig() {
    const config = await this.globalDifyConfigs?.find();

    if (!config?.enabled || !config.apiBaseUrl.trim() || !config.apiKey.trim()) {
      return undefined;
    }

    return {
      apiBaseUrl: config.apiBaseUrl,
      apiKey: config.apiKey,
      appName: config.appName,
      revision: config.revision,
    };
  }

  private async resolveRagflowRuntimeConfig() {
    const config = await this.globalRagflowConfigs?.find();

    if (
      !config?.enabled
      || !config.apiBaseUrl.trim()
      || !config.apiKey.trim()
      || config.datasetIds.length === 0
    ) {
      return undefined;
    }

    return {
      apiBaseUrl: config.apiBaseUrl,
      apiKey: config.apiKey,
      datasetIds: config.datasetIds,
      knowledgeBaseName: config.knowledgeBaseName,
      revision: config.revision,
    };
  }
}

function waitForChildExitDuringDispose(child: ChildProcess, timeoutMs = 2_000) {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(finish, timeoutMs);
    timeout.unref();
    child.once('exit', finish);
    child.once('close', finish);
  });
}

function hasChildExited(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null;
}

function isAdminMessageResult(value: unknown): value is AdminMessageResult {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<AdminMessageResult>;
  return candidate.type === 'weclaws_admin_message_result'
    && typeof candidate.deliveryId === 'string'
    && typeof candidate.ok === 'boolean'
    && (candidate.error === undefined || typeof candidate.error === 'string');
}

function isUserActiveMessage(value: unknown): value is UserActiveMessage {
  if (typeof value !== 'object' || value === null) return false;
  const keys = Object.keys(value);
  return keys.length === 1
    && keys[0] === 'type'
    && (value as Partial<UserActiveMessage>).type === 'weclaws_user_active';
}


function isExternalTurnResult(value: unknown): value is ExternalTurnResult {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ExternalTurnResult>;
  return candidate.type === 'weclaws_external_turn_result'
    && typeof candidate.requestId === 'string'
    && typeof candidate.ok === 'boolean'
    && (candidate.sessionId === undefined || typeof candidate.sessionId === 'string')
    && (candidate.text === undefined || typeof candidate.text === 'string')
    && (candidate.error === undefined || typeof candidate.error === 'string');
}

function isExternalTurnEvent(value: unknown): value is ExternalTurnEvent {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ExternalTurnEvent>;
  return candidate.type === 'weclaws_external_turn_event'
    && typeof candidate.requestId === 'string'
    && candidate.event !== undefined;
}

function normalizeExternalTurnDenyTools(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error('External turn denyTools must be an array.');
  }
  if (value.length > MAX_EXTERNAL_TURN_DENIED_TOOLS) {
    throw new Error(`External turn denyTools cannot contain more than ${MAX_EXTERNAL_TURN_DENIED_TOOLS} names.`);
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'string') {
      throw new Error('External turn denied tool name is invalid.');
    }
    const toolName = candidate.trim().toLowerCase();
    if (!SAFE_EXTERNAL_TURN_TOOL_NAME_PATTERN.test(toolName)) {
      throw new Error(`External turn denied tool name is invalid: ${candidate}.`);
    }
    if (!seen.has(toolName)) {
      seen.add(toolName);
      normalized.push(toolName);
    }
  }

  return normalized.length > 0 ? normalized : undefined;
}
