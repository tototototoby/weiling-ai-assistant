import { beforeEach, describe, expect, it, vi } from 'vitest';

const createBotMock = vi.fn();
const startBotMock = vi.fn();
const enableBotQrShareMock = vi.fn();
const getBotQrShareForOwnerMock = vi.fn();
const repositories = {
  botInstances: { findById: vi.fn() },
  employeeDirectory: {
    claimReservationWithoutUser: vi.fn(),
    findById: vi.fn(),
    findClaimedByInviteAndName: vi.fn(),
    releaseReservation: vi.fn(),
    reserveByInviteAndName: vi.fn(),
    updateById: vi.fn(),
  },
  registrationOnboardingConfig: { get: vi.fn() },
  userLlmProfiles: { findById: vi.fn() },
};

vi.mock('../bot-service', () => ({
  createBot: createBotMock,
  startBot: startBotMock,
}));

vi.mock('../bot-qr-share-service', () => ({
  enableBotQrShare: enableBotQrShareMock,
  getBotQrShareForOwner: getBotQrShareForOwnerMock,
}));

vi.mock('../repositories', () => ({
  getRepositories: () => repositories,
}));

describe('registerEmployeeFromInvite', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    repositories.registrationOnboardingConfig.get.mockResolvedValue({ defaultLlmProfileId: 'profile_1' });
    repositories.employeeDirectory.findClaimedByInviteAndName.mockResolvedValue(null);
    repositories.userLlmProfiles.findById.mockResolvedValue({
      id: 'profile_1',
      model: 'gpt-5.4',
      provider: 'openai',
      userId: 'admin_1',
    });
    repositories.employeeDirectory.reserveByInviteAndName.mockResolvedValue({
      id: 'employee_1',
      legalName: 'Zhang Ting',
      nickname: null,
    });
    repositories.employeeDirectory.claimReservationWithoutUser.mockResolvedValue({ id: 'employee_1' });
    repositories.botInstances.findById.mockResolvedValue(null);
    createBotMock.mockResolvedValue({ id: 'bot_1' });
    startBotMock.mockResolvedValue({ id: 'bot_1' });
    enableBotQrShareMock.mockResolvedValue({ publicUrl: 'http://localhost:3000/share/qr/share_token' });
    getBotQrShareForOwnerMock.mockResolvedValue(null);
  });

  it('creates a default-model Bot and finalizes the claim without a user binding', async () => {
    const { registerEmployeeFromInvite } = await import('../employee-onboarding');

    await expect(registerEmployeeFromInvite({
      inviteToken: 'invite_token',
      submittedName: 'Zhang Ting',
    })).resolves.toEqual({
      botId: 'bot_1',
      publicUrl: 'http://localhost:3000/share/qr/share_token',
    });

    expect(createBotMock).toHaveBeenCalledWith({
      desiredState: 'stopped',
      llmProfileId: 'profile_1',
      name: expect.any(String),
      ownerUserId: 'admin_1',
      skipQuota: true,
    });
    expect(enableBotQrShareMock).toHaveBeenCalledWith('bot_1');
    expect(repositories.employeeDirectory.claimReservationWithoutUser).toHaveBeenCalledWith(expect.any(String), 'bot_1');
    expect(startBotMock).toHaveBeenCalledWith('bot_1');
  });

  it('keeps a claimed Bot recoverable when the initial start intent fails', async () => {
    const { registerEmployeeFromInvite } = await import('../employee-onboarding');
    startBotMock.mockRejectedValueOnce(new Error('temporary start failure'));

    await expect(registerEmployeeFromInvite({
      inviteToken: 'invite_token',
      submittedName: 'Zhang Ting',
    })).rejects.toThrow('temporary start failure');

    expect(repositories.employeeDirectory.releaseReservation).not.toHaveBeenCalled();

    repositories.employeeDirectory.findClaimedByInviteAndName.mockResolvedValue({
      claimedBotInstanceId: 'bot_1',
    });
    repositories.botInstances.findById.mockResolvedValue({ id: 'bot_1', desiredState: 'stopped' });
    getBotQrShareForOwnerMock.mockResolvedValue({ publicUrl: 'http://localhost:3000/share/qr/share_token' });
    startBotMock.mockResolvedValueOnce({ id: 'bot_1' });

    await expect(registerEmployeeFromInvite({
      inviteToken: 'invite_token',
      submittedName: 'Zhang Ting',
    })).resolves.toEqual({
      botId: 'bot_1',
      publicUrl: 'http://localhost:3000/share/qr/share_token',
    });
    expect(startBotMock).toHaveBeenLastCalledWith('bot_1');
  });
});

describe('updateEmployeeDirectoryEntry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    repositories.employeeDirectory.findById.mockResolvedValue({
      companyEmail: 'special.address@example.com',
      enabled: true,
      id: 'employee_1',
      legalName: '章廷',
      nickname: null,
    });
    repositories.employeeDirectory.updateById.mockImplementation(async (
      _id: string,
      input: {
        companyEmail?: string | null;
        enabled: boolean;
        legalName: string | null;
        nickname: string | null;
      },
    ) => ({
      claimedAt: null,
      claimedBotInstanceId: 'bot_1',
      claimedByUserId: null,
      companyEmail: input.companyEmail === undefined ? 'special.address@example.com' : input.companyEmail,
      createdAt: new Date('2026-08-05T00:00:00.000Z'),
      enabled: input.enabled,
      id: 'employee_1',
      legalName: input.legalName,
      nickname: input.nickname,
      updatedAt: new Date('2026-08-05T00:00:01.000Z'),
    }));
  });

  it('preserves a manually configured company email when PATCH omits the field', async () => {
    const { updateEmployeeDirectoryEntry } = await import('../employee-onboarding');

    await expect(updateEmployeeDirectoryEntry('employee_1', {
      enabled: false,
      nickname: '婷婷',
    })).resolves.toMatchObject({
      companyEmail: 'special.address@example.com',
      enabled: false,
      nickname: '婷婷',
    });
    expect(repositories.employeeDirectory.updateById).toHaveBeenCalledWith(
      'employee_1',
      expect.objectContaining({ companyEmail: undefined }),
    );
  });
});
