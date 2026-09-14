import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createDatabaseClientMock = vi.fn();

class UserRepositoryMock {
  constructor(readonly db: object) {}
}

class AdminMessageDeliveryRepositoryMock {
  constructor(readonly db: object) {}
}

class UserLlmProfileRepositoryMock {
  constructor(readonly db: object) {}
}

class RegistrationBootstrapClaimRepositoryMock {
  constructor(readonly db: object) {}
}

class WorkspaceRepositoryMock {
  constructor(readonly db: object) {}

  deleteById() {
    return Promise.resolve(true);
  }
}

class BotInstanceRepositoryMock {
  constructor(readonly db: object) {}
}

class BotAgentConfigSyncRepositoryMock {
  constructor(readonly db: object) {}
}

class BotAgentConfigOverrideRepositoryMock {
  constructor(readonly db: object) {}
}

class GlobalAgentConfigRepositoryMock {
  constructor(readonly db: object) {}
}

class GlobalAdminMessageConfigRepositoryMock {
  constructor(readonly db: object) {}
}

class GlobalDifyConfigRepositoryMock {
  constructor(readonly db: object) {}
}

class BotDifySyncRepositoryMock {
  constructor(readonly db: object) {}
}

class GlobalRagflowConfigRepositoryMock {
  constructor(readonly db: object) {}
}

class BotRagflowSyncRepositoryMock {
  constructor(readonly db: object) {}
}

class MorningBriefingPolicyRepositoryMock {
  constructor(readonly db: object) {}
}

class BotQrShareRepositoryMock {
  constructor(readonly db: object) {}
}

class BotDailyActivityRepositoryMock {
  constructor(readonly db: object) {}
}

class DeliveryHealthCheckRepositoryMock {
  constructor(readonly db: object) {}
}

class EmployeeGroupRepositoryMock {
  constructor(readonly db: object) {}
}

class GlobalBroadcastConfigRepositoryMock {
  constructor(readonly db: object) {}
}

class GlobalDeliveryHealthConfigRepositoryMock {
  constructor(readonly db: object) {}
}

class GlobalImagegenConfigRepositoryMock {
  constructor(readonly db: object) {}
}

class GroupTaskRepositoryMock {
  constructor(readonly db: object) {}
}

class WebChatMessageRepositoryMock {
  constructor(readonly db: object) {}
}

class BotEventRepositoryMock {
  constructor(readonly db: object) {}
}

class RegistrationInviteRepositoryMock {
  constructor(readonly db: object) {}
}

class BotSandboxRuntimePoolRepositoryMock {
  constructor(readonly db: object) {}
}

class EmployeeDirectoryRepositoryMock {
  constructor(readonly db: object) {}
}

class EmployeeInviteLinkRepositoryMock {
  constructor(readonly db: object) {}
}

class EmailDeliveryRepositoryMock {
  constructor(readonly db: object) {}
}

class GlobalEmailConfigRepositoryMock {
  constructor(readonly db: object) {}
}

class BotWecomBindingRepositoryMock {
  constructor(readonly db: object) {}
}

class BotFeishuConfigRepositoryMock {
  constructor(readonly db: object) {}
}

class BotFeishuEventRepositoryMock {
  constructor(readonly db: object) {}
}

class BotFeishuGroupSessionRepositoryMock {
  constructor(readonly db: object) {}
}

class GlobalWecomConfigRepositoryMock {
  constructor(readonly db: object) {}
}

class RegistrationOnboardingConfigRepositoryMock {
  constructor(readonly db: object) {}
}

class WecomOnboardingRepositoryMock {
  constructor(readonly db: object) {}
}

vi.mock('@weiling-ai/db', () => ({
  AdminMessageDeliveryRepository: AdminMessageDeliveryRepositoryMock,
  BotDailyActivityRepository: BotDailyActivityRepositoryMock,
  BotAgentConfigOverrideRepository: BotAgentConfigOverrideRepositoryMock,
  BotAgentConfigSyncRepository: BotAgentConfigSyncRepositoryMock,
  BotDifySyncRepository: BotDifySyncRepositoryMock,
  BotEventRepository: BotEventRepositoryMock,
  BotFeishuConfigRepository: BotFeishuConfigRepositoryMock,
  BotFeishuEventRepository: BotFeishuEventRepositoryMock,
  BotFeishuGroupSessionRepository: BotFeishuGroupSessionRepositoryMock,
  BotInstanceRepository: BotInstanceRepositoryMock,
  BotRagflowSyncRepository: BotRagflowSyncRepositoryMock,
  BotSandboxRuntimePoolRepository: BotSandboxRuntimePoolRepositoryMock,
  DeliveryHealthCheckRepository: DeliveryHealthCheckRepositoryMock,
  EmployeeDirectoryRepository: EmployeeDirectoryRepositoryMock,
  EmployeeGroupRepository: EmployeeGroupRepositoryMock,
  EmailDeliveryRepository: EmailDeliveryRepositoryMock,
  EmployeeInviteLinkRepository: EmployeeInviteLinkRepositoryMock,
  BotWecomBindingRepository: BotWecomBindingRepositoryMock,
  BotQrShareRepository: BotQrShareRepositoryMock,
  GlobalAgentConfigRepository: GlobalAgentConfigRepositoryMock,
  GlobalAdminMessageConfigRepository: GlobalAdminMessageConfigRepositoryMock,
  GlobalBroadcastConfigRepository: GlobalBroadcastConfigRepositoryMock,
  GlobalDeliveryHealthConfigRepository: GlobalDeliveryHealthConfigRepositoryMock,
  GlobalDifyConfigRepository: GlobalDifyConfigRepositoryMock,
  GlobalEmailConfigRepository: GlobalEmailConfigRepositoryMock,
  GlobalImagegenConfigRepository: GlobalImagegenConfigRepositoryMock,
  GlobalRagflowConfigRepository: GlobalRagflowConfigRepositoryMock,
  GlobalWecomConfigRepository: GlobalWecomConfigRepositoryMock,
  MorningBriefingPolicyRepository: MorningBriefingPolicyRepositoryMock,
  GroupTaskRepository: GroupTaskRepositoryMock,
  RegistrationBootstrapClaimRepository: RegistrationBootstrapClaimRepositoryMock,
  RegistrationInviteRepository: RegistrationInviteRepositoryMock,
  RegistrationOnboardingConfigRepository: RegistrationOnboardingConfigRepositoryMock,
  UserLlmProfileRepository: UserLlmProfileRepositoryMock,
  UserRepository: UserRepositoryMock,
  WecomOnboardingRepository: WecomOnboardingRepositoryMock,
  WebChatMessageRepository: WebChatMessageRepositoryMock,
  WorkspaceRepository: WorkspaceRepositoryMock,
  createDatabaseClient: createDatabaseClientMock,
}));

vi.mock('../env', () => ({
  getEnv: () => ({
    APP_BASE_URL: 'http://localhost:3000',
    BETTER_AUTH_SECRET: 'secret',
    DATABASE_URL: 'file:./storage/sqlite/db.sqlite',
  }),
  getWorkspaceRoot: () => '/tmp/weiling',
}));

describe('getRepositories', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    globalThis.__weixinClawsWebDatabaseClient = {
      close: () => {},
      connection: {} as never,
      db: {} as never,
      url: 'file:./storage/sqlite/db.sqlite',
    };
    (globalThis as { __weixinClawsWebRepositories?: unknown }).__weixinClawsWebRepositories = {
      workspaces: {},
    };
  });

  afterEach(() => {
    globalThis.__weixinClawsWebDatabaseClient = undefined;
    (globalThis as { __weixinClawsWebRepositories?: unknown }).__weixinClawsWebRepositories = undefined;
  });

  it('rebuilds repository instances instead of reusing stale globals across hot reloads', async () => {
    const { getRepositories } = await import('../repositories');

    const repositories = getRepositories();

    expect(repositories.workspaces).toBeInstanceOf(WorkspaceRepositoryMock);
    expect(typeof repositories.workspaces.deleteById).toBe('function');
    expect(repositories.botAgentConfigOverrides).toBeInstanceOf(BotAgentConfigOverrideRepositoryMock);
    expect(repositories.botDifySyncStates).toBeInstanceOf(BotDifySyncRepositoryMock);
    expect(repositories.globalDifyConfigs).toBeInstanceOf(GlobalDifyConfigRepositoryMock);
    expect(repositories.botRagflowSyncStates).toBeInstanceOf(BotRagflowSyncRepositoryMock);
    expect(repositories.globalRagflowConfigs).toBeInstanceOf(GlobalRagflowConfigRepositoryMock);
    expect(repositories.adminMessageDeliveries).toBeInstanceOf(AdminMessageDeliveryRepositoryMock);
    expect(repositories.globalAdminMessageConfigs).toBeInstanceOf(GlobalAdminMessageConfigRepositoryMock);
    expect(repositories.employeeDirectory).toBeInstanceOf(EmployeeDirectoryRepositoryMock);
    expect(repositories.emailDeliveries).toBeInstanceOf(EmailDeliveryRepositoryMock);
    expect(repositories.globalEmailConfigs).toBeInstanceOf(GlobalEmailConfigRepositoryMock);
    expect(repositories.botWecomBindings).toBeInstanceOf(BotWecomBindingRepositoryMock);
    expect(repositories.botFeishuConfigs).toBeInstanceOf(BotFeishuConfigRepositoryMock);
    expect(repositories.botFeishuEvents).toBeInstanceOf(BotFeishuEventRepositoryMock);
    expect(repositories.botFeishuGroupSessions).toBeInstanceOf(BotFeishuGroupSessionRepositoryMock);
    expect(repositories.globalWecomConfigs).toBeInstanceOf(GlobalWecomConfigRepositoryMock);
    expect(repositories.wecomOnboarding).toBeInstanceOf(WecomOnboardingRepositoryMock);
    expect(repositories.botQrShares).toBeInstanceOf(BotQrShareRepositoryMock);
    expect(repositories.botSandboxRuntimePools).toBeInstanceOf(BotSandboxRuntimePoolRepositoryMock);
  });
});
