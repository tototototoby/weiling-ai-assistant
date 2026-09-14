import {
  AdminMessageDeliveryRepository,
  BotAgentConfigSyncRepository,
  BotAgentConfigOverrideRepository,
  BotDifySyncRepository,
  BotDailyActivityRepository,
  BotEventRepository,
  BotFeishuConfigRepository,
  BotFeishuEventRepository,
  BotFeishuGroupSessionRepository,
  BotInstanceRepository,
  BotRagflowSyncRepository,
  BotSandboxRuntimePoolRepository,
  BotWecomBindingRepository,
  DeliveryHealthCheckRepository,
  EmailDeliveryRepository,
  EmployeeDirectoryRepository,
  EmployeeGroupRepository,
  GlobalAdminMessageConfigRepository,
  GlobalAgentConfigRepository,
  GlobalBroadcastConfigRepository,
  GlobalDeliveryHealthConfigRepository,
  GlobalDifyConfigRepository,
  GlobalEmailConfigRepository,
  GlobalImagegenConfigRepository,
  GlobalRagflowConfigRepository,
  GlobalWecomConfigRepository,
  GroupTaskRepository,
  MealReminderPreferenceRepository,
  MorningBriefingPolicyRepository,
  ScheduledTaskRecoveryRepository,
  UserLlmProfileRepository,
  WecomMessageReceiptRepository,
  WecomOnboardingRepository,
  WecomProactiveDeliveryRepository,
  createDatabaseClient,
  migrateDatabase,
} from '@weiling-ai/db';
import type { SupervisorConfig } from './config';
import { getSupervisorConfig } from './config';
import { InstanceLock } from './runtime/instance-lock';
import { AdminMessageDispatcher } from './runtime/admin-message-dispatcher';
import { DifyConfigReconciler } from './runtime/dify-config-reconciler';
import { ImagegenConfigReconciler } from './runtime/imagegen-config-reconciler';
import { WeclawsBridgeReconciler } from './runtime/weclaws-bridge-reconciler';
import { EmailDeliveryDispatcher } from './runtime/email-delivery-dispatcher';
import { GlobalEmailSecretReader } from './runtime/global-email-secret';
import { RagflowConfigReconciler } from './runtime/ragflow-config-reconciler';
import { InstanceReconciler } from './runtime/instance-reconciler';
import { GlobalAgentConfigReconciler } from './runtime/global-agent-config-reconciler';
import { MorningBriefingPolicyReconciler } from './runtime/morning-briefing-policy-reconciler';
import { MorningBriefingScheduler } from './runtime/morning-briefing-scheduler';
import { MealReminderScheduler } from './runtime/meal-reminder-scheduler';
import { DeliveryHealthScheduler } from './runtime/delivery-health-scheduler';
import { getShanghaiDateTime } from './runtime/meal-reminder-scheduler';
import { NodemailerGlobalEmailSender } from './runtime/global-email-sender';
import { createInternalHttpServer } from './runtime/internal-http-server';
import { BroadcastService } from './runtime/broadcast-service';
import { ProcessManager } from './runtime/process-manager';
import {
  createSingleFlightTask,
  type SingleFlightTask,
} from './runtime/single-flight-task';
import {
  WecomChannelGateway,
  WeixinFirstMessageSender,
} from './runtime/wecom-channel-gateway';
import { FeishuChannelGateway } from './runtime/feishu-channel-gateway';
import { ScheduledTaskRecoveryReconciler } from './runtime/scheduled-task-recovery-reconciler';
import { DynamicAdminMessageCopyProvider } from './runtime/admin-message-copy';
import { WecomOnboardingFlow } from './runtime/wecom-onboarding';
import { renderAllSandboxRuntimePools } from './runtime/srt-pool-provisioning';
import {
  resolveSupervisorSingletonLockPath,
  SupervisorSingletonLock,
} from './runtime/supervisor-singleton-lock';

export interface SupervisorRuntime {
  close(): Promise<void>;
}

type ShutdownSignal = 'SIGINT' | 'SIGTERM';

export interface RunSupervisorProcessOptions {
  exit?: (exitCode: number) => void;
  logError?: (error: unknown) => void;
  registerSignal?: (signal: ShutdownSignal, handler: () => void) => void;
  start?: () => Promise<SupervisorRuntime>;
}

export function scheduleReconcilePass(
  reconciler: Pick<InstanceReconciler, 'runOnce'>,
  onError: (error: unknown) => void = console.error,
) {
  void reconciler.runOnce().catch(onError);
}

export async function runMorningBriefingPolicyPass(
  reconciler: Pick<MorningBriefingPolicyReconciler, 'runOnce'>,
  onError: (error: unknown) => void = console.error,
): Promise<void> {
  await reconciler.runOnce().catch(onError);
}

export async function runGlobalAgentConfigPass(
  reconciler: Pick<GlobalAgentConfigReconciler, 'runOnce'>,
  onError: (error: unknown) => void = console.error,
): Promise<void> {
  await reconciler.runOnce().catch(onError);
}

export async function runAdminMessagePass(
  dispatcher: Pick<AdminMessageDispatcher, 'runOnce'>,
  onError: (error: unknown) => void = console.error,
): Promise<void> {
  await dispatcher.runOnce().catch(onError);
}

export async function runEmailDeliveryPass(
  dispatcher: Pick<EmailDeliveryDispatcher, 'runOnce'>,
  onError: (error: unknown) => void = console.error,
): Promise<void> {
  await dispatcher.runOnce().catch(onError);
}

export async function runMealReminderPass(
  scheduler: Pick<MealReminderScheduler, 'runOnce'>,
  onError: (error: unknown) => void = console.error,
): Promise<void> {
  await scheduler.runOnce().catch(onError);
}

export async function runMorningBriefingPass(
  scheduler: Pick<MorningBriefingScheduler, 'runOnce'>,
  onError: (error: unknown) => void = console.error,
): Promise<void> {
  await scheduler.runOnce().catch(onError);
}

export async function runDeliveryHealthPass(
  scheduler: Pick<DeliveryHealthScheduler, 'runOnce'>,
  onError: (error: unknown) => void = console.error,
): Promise<void> {
  await scheduler.runOnce().catch(onError);
}

export async function runDifyConfigPass(
  reconciler: Pick<DifyConfigReconciler, 'runOnce'>,
  onError: (error: unknown) => void = console.error,
): Promise<void> {
  await reconciler.runOnce().catch(onError);
}

export async function runRagflowConfigPass(
  reconciler: Pick<RagflowConfigReconciler, 'runOnce'>,
  onError: (error: unknown) => void = console.error,
): Promise<void> {
  await reconciler.runOnce().catch(onError);
}

export async function runImagegenConfigPass(
  reconciler: Pick<ImagegenConfigReconciler, 'runOnce'>,
  botInstanceIds: readonly string[],
  onError: (error: unknown) => void = console.error,
): Promise<void> {
  await reconciler.runOnce(botInstanceIds).catch(onError);
}

export async function runWecomChannelPass(
  gateway: Pick<WecomChannelGateway, 'runOnce'>,
  onError: (error: unknown) => void = console.error,
): Promise<void> {
  await gateway.runOnce().catch(onError);
}

export async function runFeishuChannelPass(
  gateway: Pick<FeishuChannelGateway, 'runOnce'>,
  onError: (error: unknown) => void = console.error,
): Promise<void> {
  await gateway.runOnce().catch(onError);
}

export async function runScheduledTaskRecoveryPass(
  reconciler: Pick<ScheduledTaskRecoveryReconciler, 'runOnce'>,
  onError: (error: unknown) => void = console.error,
): Promise<void> {
  await reconciler.runOnce().catch(onError);
}

export async function startSupervisor(): Promise<SupervisorRuntime> {
  const config = getSupervisorConfig();
  const singletonLock = new SupervisorSingletonLock(
    resolveSupervisorSingletonLockPath(config.workspaceRoot),
  );
  await singletonLock.acquire();

  let interval: ReturnType<typeof setInterval> | null = null;
  let client: ReturnType<typeof createDatabaseClient> | null = null;
  let reconcileTask: SingleFlightTask | null = null;

  try {
    client = createDatabaseClient({
      baseDir: config.workspaceRoot,
      url: config.databaseUrl,
    });

    migrateDatabase(client);

    const adminMessageDeliveries = new AdminMessageDeliveryRepository(client.db);
    const globalAdminMessageConfig = new GlobalAdminMessageConfigRepository(client.db);
    const adminMessageCopy = new DynamicAdminMessageCopyProvider(globalAdminMessageConfig);
    const botInstances = new BotInstanceRepository(client.db);
    const botAgentConfigSyncStates = new BotAgentConfigSyncRepository(client.db);
    const botAgentConfigOverrides = new BotAgentConfigOverrideRepository(client.db);
    const botDifySyncStates = new BotDifySyncRepository(client.db);
    const botRagflowSyncStates = new BotRagflowSyncRepository(client.db);
    const botEvents = new BotEventRepository(client.db);
    const globalAgentConfig = new GlobalAgentConfigRepository(client.db);
    const globalDifyConfig = new GlobalDifyConfigRepository(client.db);
    const globalEmailConfig = new GlobalEmailConfigRepository(client.db);
    const emailDeliveries = new EmailDeliveryRepository(client.db);
    const globalRagflowConfig = new GlobalRagflowConfigRepository(client.db);
    const globalWecomConfig = new GlobalWecomConfigRepository(client.db);
    const botWecomBindings = new BotWecomBindingRepository(client.db);
    const wecomProactiveDeliveries = new WecomProactiveDeliveryRepository(client.db);
    const wecomMessageReceipts = new WecomMessageReceiptRepository(client.db);
    const wecomOnboardingRepository = new WecomOnboardingRepository(client.db);
    const botFeishuConfigs = new BotFeishuConfigRepository(client.db);
    const botFeishuEvents = new BotFeishuEventRepository(client.db);
    const botFeishuGroupSessions = new BotFeishuGroupSessionRepository(client.db);
    const scheduledTaskRecoveries = new ScheduledTaskRecoveryRepository(client.db);
    const mealReminderPreferences = new MealReminderPreferenceRepository(client.db);
    const morningBriefingPolicies = new MorningBriefingPolicyRepository(client.db);
    const userLlmProfiles = new UserLlmProfileRepository(client.db);
    const botSandboxRuntimePools = new BotSandboxRuntimePoolRepository(client.db);
    const employeeGroups = new EmployeeGroupRepository(client.db);
    const employeeDirectory = new EmployeeDirectoryRepository(client.db);
    const groupTasks = new GroupTaskRepository(client.db);
    const globalBroadcastConfig = new GlobalBroadcastConfigRepository(client.db);
    const globalDeliveryHealthConfig = new GlobalDeliveryHealthConfigRepository(client.db);
    const globalImagegenConfig = new GlobalImagegenConfigRepository(client.db);
    const deliveryHealthChecks = new DeliveryHealthCheckRepository(client.db);
    const botDailyActivity = new BotDailyActivityRepository(client.db);
    let adminMessageDispatcher: AdminMessageDispatcher | null = null;
    let mealReminderScheduler: MealReminderScheduler | null = null;
    const handleUserActive = async (botInstanceId: string) => {
      const activityDate = getShanghaiDateTime(new Date()).date;
      await Promise.all([
        adminMessageDispatcher?.handleUserActive(botInstanceId),
        mealReminderScheduler?.handleUserActive(botInstanceId),
        botDailyActivity.incrementInbound(botInstanceId, activityDate),
        botDailyActivity.incrementOutbound(botInstanceId, activityDate),
      ]);
    };
    const processManager = new ProcessManager({
      botEvents,
      botInstances,
      config,
      globalDifyConfigs: globalDifyConfig,
      globalRagflowConfigs: globalRagflowConfig,
      messageCopy: adminMessageCopy,
      onUserActive: handleUserActive,
      resolveEnabledManagedSkillNames: async () => {
        const snapshot = await globalAgentConfig.getSnapshot();

        if (!snapshot) {
          throw new Error('Global agent config is not initialized.');
        }

        return snapshot.skills
          .filter((skill) => skill.enabled)
          .map((skill) => skill.skillName);
      },
      userLlmProfiles,
      botSandboxRuntimePools,
    });
    const internalServer = createInternalHttpServer({
      apiToken: config.internalApiToken,
      broadcast: new BroadcastService({
        botInstances,
        broadcastConfig: globalBroadcastConfig,
        deliveries: adminMessageDeliveries,
        employeeDirectory,
        employeeGroups,
      }),
      employeeDirectory,
      employeeGroups,
      groupTaskService: groupTasks,
      port: config.internalPort,
      processManager,
    });
    if (!config.internalApiToken) {
      console.warn('WEILING_INTERNAL_API_TOKEN is not configured; the internal web-chat bridge will reject every request.');
    }
    internalServer.listen(config.internalPort, '0.0.0.0');
    const reconciler = new InstanceReconciler({
      botInstances,
      lock: new InstanceLock(),
      processManager,
    });
    const wecomGateway = new WecomChannelGateway({
      bindings: botWecomBindings,
      configs: globalWecomConfig,
      messageCopy: adminMessageCopy,
      onboarding: new WecomOnboardingFlow(wecomOnboardingRepository, adminMessageCopy),
      onUserActive: handleUserActive,
      processManager,
      proactiveDeliveries: wecomProactiveDeliveries,
      receipts: wecomMessageReceipts,
    });
    const feishuGateway = new FeishuChannelGateway({
      botInstances,
      config,
      configs: botFeishuConfigs,
      events: botFeishuEvents,
      groupSessions: botFeishuGroupSessions,
      messageCopy: adminMessageCopy,
      onUserActive: handleUserActive,
      processManager,
    });
    const preferredMessageSender = new WeixinFirstMessageSender(
      processManager,
      wecomGateway,
      {
        emailDeliveries,
        employeeDirectory,
        messageCopy: adminMessageCopy,
      },
    );
    const imOnlyMessageSender = new WeixinFirstMessageSender(
      processManager,
      wecomGateway,
      {
        emailFallback: false,
        messageCopy: adminMessageCopy,
      },
    );
    const scheduledTaskRecoveryReconciler = new ScheduledTaskRecoveryReconciler({
      botInstances,
      config,
      messageSender: imOnlyMessageSender,
      processManager,
      recoveries: scheduledTaskRecoveries,
    });
    adminMessageDispatcher = new AdminMessageDispatcher({
      botInstances,
      config: globalAdminMessageConfig,
      deliveries: adminMessageDeliveries,
      imOnlySender: imOnlyMessageSender,
      processManager: preferredMessageSender,
    });
    mealReminderScheduler = new MealReminderScheduler({
      messageCopy: adminMessageCopy,
      processManager: preferredMessageSender,
      preferences: mealReminderPreferences,
      reminderQueue: adminMessageDispatcher,
      workspaceRoot: config.workspaceRoot,
    });
    const morningBriefingScheduler = new MorningBriefingScheduler({
      adminMessageDispatcher,
      instancesRoot: config.instancesRoot,
      messageCopy: adminMessageCopy,
      policies: morningBriefingPolicies,
      processManager: preferredMessageSender,
      workspaceRoot: config.workspaceRoot,
    });
    const deliveryHealthScheduler = new DeliveryHealthScheduler({
      botEvents,
      config: globalDeliveryHealthConfig,
      deliveries: adminMessageDeliveries,
      emailConfig: globalEmailConfig,
      healthChecks: deliveryHealthChecks,
      sender: new NodemailerGlobalEmailSender({
        secretReader: new GlobalEmailSecretReader({ workspaceRoot: config.workspaceRoot }),
      }),
    });
    const emailDeliveryDispatcher = new EmailDeliveryDispatcher({
      config: globalEmailConfig,
      deliveries: emailDeliveries,
      sender: new NodemailerGlobalEmailSender({
        secretReader: new GlobalEmailSecretReader({ workspaceRoot: config.workspaceRoot }),
      }),
      workspaceRoot: config.workspaceRoot,
    });
    const difyConfigReconciler = new DifyConfigReconciler({
      botInstances,
      configRepository: globalDifyConfig,
      instancesRoot: config.instancesRoot,
      syncStateRepository: botDifySyncStates,
    });
    const ragflowConfigReconciler = new RagflowConfigReconciler({
      botInstances,
      configRepository: globalRagflowConfig,
      instancesRoot: config.instancesRoot,
      syncStateRepository: botRagflowSyncStates,
    });
    const imagegenConfigReconciler = new ImagegenConfigReconciler({
      configRepository: globalImagegenConfig,
      instancesRoot: config.instancesRoot,
    });
    const weclawsBridgeReconciler = new WeclawsBridgeReconciler({
      apiToken: config.internalApiToken,
      instancesRoot: config.instancesRoot,
      internalPort: config.internalPort,
    });
    const morningBriefingPolicyReconciler = new MorningBriefingPolicyReconciler({
      instancesRoot: config.instancesRoot,
      policies: morningBriefingPolicies,
    });
    const globalAgentConfigReconciler = new GlobalAgentConfigReconciler({
      configRepository: globalAgentConfig,
      instancesRoot: config.instancesRoot,
      overrideRepository: botAgentConfigOverrides,
      syncStateRepository: botAgentConfigSyncStates,
      workspaceRoot: config.workspaceRoot,
    });
    const logReconcileError = (error: unknown) => {
      console.error('Supervisor reconcile pass failed.');
      console.error(error);
    };

    const runReconcileCycle = async () => {
      await renderSandboxRuntimePoolsIfEnabled(config, botSandboxRuntimePools);
      await runGlobalAgentConfigPass(globalAgentConfigReconciler, logReconcileError);
      await runDifyConfigPass(difyConfigReconciler, logReconcileError);
      await runRagflowConfigPass(ragflowConfigReconciler, logReconcileError);
      await runImagegenConfigPass(
        imagegenConfigReconciler,
        (await botInstances.listAllForAdministration()).map((bot) => bot.id),
        logReconcileError,
      );
      await weclawsBridgeReconciler.runOnce(
        (await botInstances.listAllForAdministration()).map((bot) => bot.id),
      );
      await runMorningBriefingPolicyPass(morningBriefingPolicyReconciler, logReconcileError);
      await reconciler.runOnce();
      await processManager.syncMessageCopy();
      await runWecomChannelPass(wecomGateway, logReconcileError);
      await runFeishuChannelPass(feishuGateway, logReconcileError);
      await runScheduledTaskRecoveryPass(scheduledTaskRecoveryReconciler, logReconcileError);
      await runMealReminderPass(mealReminderScheduler, logReconcileError);
      await runAdminMessagePass(adminMessageDispatcher, logReconcileError);
      await runMorningBriefingPass(morningBriefingScheduler, logReconcileError);
      await runDeliveryHealthPass(deliveryHealthScheduler, logReconcileError);
      await runEmailDeliveryPass(emailDeliveryDispatcher, logReconcileError);
    };

    await runReconcileCycle();
    reconcileTask = createSingleFlightTask(runReconcileCycle, logReconcileError, {
      onStall: (error) => {
        console.error('Supervisor reconcile pass stalled; exiting for automatic recovery.');
        console.error(error);
        process.exit(1);
      },
      stallTimeoutMs: config.reconcileStallTimeoutMs,
    });
    interval = setInterval(() => {
      void reconcileTask?.run();
    }, config.reconcileIntervalMs);

    let closed = false;

    return {
      close: async () => {
        if (closed) {
          return;
        }

        closed = true;

        if (interval) {
          clearInterval(interval);
          interval = null;
        }

        await reconcileTask?.waitForIdle();

        try {
          internalServer.close();
          await wecomGateway.dispose();
          await feishuGateway.dispose();
          await processManager.dispose();
        } finally {
          try {
            client?.close();
          } finally {
            await singletonLock.release();
          }
        }
      },
    };
  } catch (error) {
    if (interval) {
      clearInterval(interval);
    }

    try {
      client?.close();
    } finally {
      await singletonLock.release();
    }
    throw error;
  }
}

async function renderSandboxRuntimePoolsIfEnabled(
  config: SupervisorConfig,
  repository: BotSandboxRuntimePoolRepository,
): Promise<void> {
  if (
    config.sandboxMode !== 'remote'
    || !config.srtPoolConfigFile
    || !config.srtServiceHost
    || !config.srtWorkspaceMapDir
  ) {
    return;
  }

  await renderAllSandboxRuntimePools({
    filePath: config.srtPoolConfigFile,
    repository,
    serviceHost: config.srtServiceHost,
    workspaceMapDir: config.srtWorkspaceMapDir,
  });
}

export function runSupervisorProcess(options: RunSupervisorProcessOptions = {}) {
  const start = options.start ?? startSupervisor;
  const exit = options.exit ?? ((exitCode) => {
    process.exit(exitCode);
  });
  const logError = options.logError ?? console.error;
  const registerSignal = options.registerSignal ?? ((signal, handler) => {
    process.on(signal, handler);
  });

  let runtime: SupervisorRuntime | null = null;
  let resolveStartupSettled!: () => void;
  const startupSettled = new Promise<void>((resolve) => {
    resolveStartupSettled = resolve;
  });
  let shutdownPromise: Promise<void> | null = null;

  const shutdown = async (exitCode: number) => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      try {
        await startupSettled;

        if (runtime) {
          await runtime.close();
        }
      } finally {
        exit(exitCode);
      }
    })();

    return shutdownPromise;
  };

  registerSignal('SIGINT', () => {
    void shutdown(0);
  });
  registerSignal('SIGTERM', () => {
    void shutdown(0);
  });

  void Promise.resolve()
    .then(() => start())
    .then((nextRuntime) => {
      runtime = nextRuntime;
    })
    .catch((error: unknown) => {
      logError(error);
      void shutdown(1);
    })
    .finally(() => {
      resolveStartupSettled();
    });
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  runSupervisorProcess();
}
