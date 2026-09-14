import {
  AdminMessageDeliveryRepository,
  BotDailyActivityRepository,
  BotRagflowSyncRepository,
  BotEventRepository,
  BotDifySyncRepository,
  BotAgentConfigOverrideRepository,
  BotAgentConfigSyncRepository,
  BotInstanceRepository,
  BotFeishuConfigRepository,
  BotFeishuEventRepository,
  BotFeishuGroupSessionRepository,
  BotSandboxRuntimePoolRepository,
  EmployeeDirectoryRepository,
  EmployeeGroupRepository,
  EmailDeliveryRepository,
  EmployeeInviteLinkRepository,
  BotWecomBindingRepository,
  DeliveryHealthCheckRepository,
  GlobalBroadcastConfigRepository,
  GlobalAgentConfigRepository,
  GlobalAdminMessageConfigRepository,
  GlobalDifyConfigRepository,
  GlobalDeliveryHealthConfigRepository,
  GlobalEmailConfigRepository,
  GlobalImagegenConfigRepository,
  GlobalRagflowConfigRepository,
  GlobalWecomConfigRepository,
  GroupTaskRepository,
  MorningBriefingPolicyRepository,
  BotQrShareRepository,
  RegistrationBootstrapClaimRepository,
  RegistrationInviteRepository,
  RegistrationOnboardingConfigRepository,
  UserRepository,
  UserLlmProfileRepository,
  WebChatMessageRepository,
  WecomOnboardingRepository,
  WorkspaceRepository,
  createDatabaseClient,
  type DatabaseClient,
} from '@weiling-ai/db';
import { getEnv, getWorkspaceRoot } from './env';

export interface WebRepositories {
  adminMessageDeliveries: AdminMessageDeliveryRepository;
  globalAdminMessageConfigs: GlobalAdminMessageConfigRepository;
  users: UserRepository;
  userLlmProfiles: UserLlmProfileRepository;
  botSandboxRuntimePools: BotSandboxRuntimePoolRepository;
  registrationBootstrapClaims: RegistrationBootstrapClaimRepository;
  workspaces: WorkspaceRepository;
  botInstances: BotInstanceRepository;
  botAgentConfigSyncStates: BotAgentConfigSyncRepository;
  botAgentConfigOverrides: BotAgentConfigOverrideRepository;
  globalAgentConfigs: GlobalAgentConfigRepository;
  globalDifyConfigs: GlobalDifyConfigRepository;
  botDifySyncStates: BotDifySyncRepository;
  globalRagflowConfigs: GlobalRagflowConfigRepository;
  botRagflowSyncStates: BotRagflowSyncRepository;
  morningBriefingPolicies: MorningBriefingPolicyRepository;
  botQrShares: BotQrShareRepository;
  botEvents: BotEventRepository;
  registrationInvites: RegistrationInviteRepository;
  employeeDirectory: EmployeeDirectoryRepository;
  emailDeliveries: EmailDeliveryRepository;
  globalEmailConfigs: GlobalEmailConfigRepository;
  employeeInviteLinks: EmployeeInviteLinkRepository;
  botWecomBindings: BotWecomBindingRepository;
  botFeishuConfigs: BotFeishuConfigRepository;
  botFeishuEvents: BotFeishuEventRepository;
  botFeishuGroupSessions: BotFeishuGroupSessionRepository;
  globalWecomConfigs: GlobalWecomConfigRepository;
  wecomOnboarding: WecomOnboardingRepository;
  registrationOnboardingConfig: RegistrationOnboardingConfigRepository;
  webChatMessages: WebChatMessageRepository;
  employeeGroups: EmployeeGroupRepository;
  groupTasks: GroupTaskRepository;
  globalBroadcastConfigs: GlobalBroadcastConfigRepository;
  globalDeliveryHealthConfigs: GlobalDeliveryHealthConfigRepository;
  globalImagegenConfigs: GlobalImagegenConfigRepository;
  deliveryHealthChecks: DeliveryHealthCheckRepository;
  botDailyActivity: BotDailyActivityRepository;
}

declare global {
  // eslint-disable-next-line no-var
  var __weixinClawsWebDatabaseClient: DatabaseClient | undefined;
}

export function getDatabaseClient(): DatabaseClient {
  if (!globalThis.__weixinClawsWebDatabaseClient) {
    const env = getEnv();
    globalThis.__weixinClawsWebDatabaseClient = createDatabaseClient({
      baseDir: getWorkspaceRoot(),
      url: env.DATABASE_URL,
    });
  }

  return globalThis.__weixinClawsWebDatabaseClient;
}

export function getRepositories(): WebRepositories {
  const client = getDatabaseClient();

  return {
    adminMessageDeliveries: new AdminMessageDeliveryRepository(client.db),
    globalAdminMessageConfigs: new GlobalAdminMessageConfigRepository(client.db),
    users: new UserRepository(client.db),
    userLlmProfiles: new UserLlmProfileRepository(client.db),
    botSandboxRuntimePools: new BotSandboxRuntimePoolRepository(client.db),
    registrationBootstrapClaims: new RegistrationBootstrapClaimRepository(client.db),
    workspaces: new WorkspaceRepository(client.db),
    botInstances: new BotInstanceRepository(client.db),
    botAgentConfigSyncStates: new BotAgentConfigSyncRepository(client.db),
    botAgentConfigOverrides: new BotAgentConfigOverrideRepository(client.db),
    globalAgentConfigs: new GlobalAgentConfigRepository(client.db),
    globalDifyConfigs: new GlobalDifyConfigRepository(client.db),
    botDifySyncStates: new BotDifySyncRepository(client.db),
    globalRagflowConfigs: new GlobalRagflowConfigRepository(client.db),
    botRagflowSyncStates: new BotRagflowSyncRepository(client.db),
    morningBriefingPolicies: new MorningBriefingPolicyRepository(client.db),
    botQrShares: new BotQrShareRepository(client.db),
    botEvents: new BotEventRepository(client.db),
    registrationInvites: new RegistrationInviteRepository(client.db),
    employeeDirectory: new EmployeeDirectoryRepository(client.db),
    emailDeliveries: new EmailDeliveryRepository(client.db),
    globalEmailConfigs: new GlobalEmailConfigRepository(client.db),
    employeeInviteLinks: new EmployeeInviteLinkRepository(client.db),
    botWecomBindings: new BotWecomBindingRepository(client.db),
    botFeishuConfigs: new BotFeishuConfigRepository(client.db),
    botFeishuEvents: new BotFeishuEventRepository(client.db),
    botFeishuGroupSessions: new BotFeishuGroupSessionRepository(client.db),
    globalWecomConfigs: new GlobalWecomConfigRepository(client.db),
    wecomOnboarding: new WecomOnboardingRepository(client.db),
    registrationOnboardingConfig: new RegistrationOnboardingConfigRepository(client.db),
    webChatMessages: new WebChatMessageRepository(client.db),
    employeeGroups: new EmployeeGroupRepository(client.db),
    groupTasks: new GroupTaskRepository(client.db),
    globalBroadcastConfigs: new GlobalBroadcastConfigRepository(client.db),
    globalDeliveryHealthConfigs: new GlobalDeliveryHealthConfigRepository(client.db),
    globalImagegenConfigs: new GlobalImagegenConfigRepository(client.db),
    deliveryHealthChecks: new DeliveryHealthCheckRepository(client.db),
    botDailyActivity: new BotDailyActivityRepository(client.db),
  };
}
