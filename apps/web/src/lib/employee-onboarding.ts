import { randomBytes, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { pinyin } from 'pinyin-pro';
import { resolveBotInstancePaths } from '@weiling-ai/shared';
import { ApiError } from './api-error';
import { INVITE_RESERVATION_TTL_MS } from './auth-invite';
import { enableBotQrShare, getBotQrShareForOwner } from './bot-qr-share-service';
import { createBot, startBot } from './bot-service';
import { resolveInstancesRoot } from './env';
import { getRepositories } from './repositories';

export interface EmployeeDirectoryItem {
  id: string;
  legalName: string | null;
  nickname: string | null;
  companyEmail: string | null;
  enabled: boolean;
  claimedAt: string | null;
  claimedBotInstanceId: string | null;
  claimedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeInviteLinkItem {
  id: string;
  token: string;
  enabled: boolean;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export function normalizeEmployeeLookupName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN');
}

export async function listEmployeeDirectory(): Promise<EmployeeDirectoryItem[]> {
  const repository = getRepositories().employeeDirectory;
  const entries = await repository.listAll();
  await Promise.all(entries.map(async (entry) => {
    if (entry.companyEmail || !entry.legalName) return;
    const derived = deriveCompanyEmail(entry.legalName);
    if (derived) await repository.updateCompanyEmail(entry.id, derived);
  }));
  return (await repository.listAll()).map(toEmployeeDirectoryItem);
}

export async function createEmployeeDirectoryEntry(input: {
  legalName?: string | null;
  nickname?: string | null;
  companyEmail?: string | null;
  enabled?: boolean;
}) {
  const names = normalizeDirectoryNames(input);
  const entry = await getRepositories().employeeDirectory.create({
    id: randomUUID(),
    ...names,
    companyEmail: input.companyEmail === undefined ? deriveCompanyEmail(names.legalName) : input.companyEmail,
    enabled: input.enabled ?? true,
  });
  if (!entry) throw internalError('Failed to create employee entry.');
  return toEmployeeDirectoryItem(entry);
}

export async function updateEmployeeDirectoryEntry(id: string, input: {
  legalName?: string | null;
  nickname?: string | null;
  companyEmail?: string | null;
  enabled: boolean;
}) {
  const current = await getRepositories().employeeDirectory.findById(id);
  if (!current) throw notFound('Employee entry not found.');
  const names = normalizeDirectoryNames({
    legalName: input.legalName === undefined ? current.legalName : input.legalName,
    nickname: input.nickname === undefined ? current.nickname : input.nickname,
  });
  const entry = await getRepositories().employeeDirectory.updateById(id, {
    ...names,
    companyEmail: input.companyEmail,
    enabled: input.enabled,
  });
  if (!entry) throw notFound('Employee entry not found.');
  return toEmployeeDirectoryItem(entry);
}

export async function deleteEmployeeDirectoryEntry(id: string) {
  if (!await getRepositories().employeeDirectory.deleteById(id)) {
    throw notFound('Employee entry not found.');
  }
  return { id };
}

export async function listEmployeeInviteLinks(): Promise<EmployeeInviteLinkItem[]> {
  return (await getRepositories().employeeInviteLinks.listRecent()).map(toEmployeeInviteLinkItem);
}

export async function createEmployeeInviteLink(createdByUserId: string) {
  const link = await getRepositories().employeeInviteLinks.create({
    id: randomUUID(),
    token: randomBytes(24).toString('base64url'),
    createdByUserId,
  });
  if (!link) throw internalError('Failed to create employee invite link.');
  return toEmployeeInviteLinkItem(link);
}

export async function setEmployeeInviteLinkEnabled(id: string, enabled: boolean) {
  const link = await getRepositories().employeeInviteLinks.setEnabled(id, enabled);
  if (!link) throw notFound('Employee invite link not found.');
  return toEmployeeInviteLinkItem(link);
}

export async function getRegistrationDefaultProfileId() {
  return (await getRepositories().registrationOnboardingConfig.get())?.defaultLlmProfileId ?? null;
}

export async function setRegistrationDefaultProfile(adminUserId: string, profileId: string) {
  const repositories = getRepositories();
  const profile = await repositories.userLlmProfiles.findByIdForUser(profileId, adminUserId);
  if (!profile) throw notFound('LLM profile not found.');
  await repositories.registrationOnboardingConfig.setDefaultLlmProfile(profile.id, adminUserId);
  return { profileId: profile.id };
}

export async function registerEmployeeFromInvite(input: {
  inviteToken: string;
  submittedName: string;
}) {
  const repositories = getRepositories();
  const normalizedName = normalizeEmployeeLookupName(input.submittedName);
  if (!normalizedName) throw validationError();

  const existingClaim = await repositories.employeeDirectory.findClaimedByInviteAndName(input.inviteToken, normalizedName);
  if (existingClaim?.claimedBotInstanceId) {
    const existingBot = await repositories.botInstances.findById(existingClaim.claimedBotInstanceId);
    if (existingBot) {
      if (existingBot.desiredState !== 'running') {
        await startBot(existingBot.id);
      }
      const share = await getBotQrShareForOwner(existingBot.id) ?? await enableBotQrShare(existingBot.id);
      return { botId: existingBot.id, publicUrl: share.publicUrl };
    }
  }

  const onboardingConfig = await repositories.registrationOnboardingConfig.get();
  const sourceProfile = onboardingConfig?.defaultLlmProfileId
    ? await repositories.userLlmProfiles.findById(onboardingConfig.defaultLlmProfileId)
    : null;

  if (!sourceProfile) {
    throw new ApiError({
      code: 'ONBOARDING_DEFAULT_MODEL_MISSING',
      message: 'The administrator has not configured an onboarding default model.',
      status: 503,
    });
  }

  const reservationToken = randomUUID();
  const employee = await repositories.employeeDirectory.reserveByInviteAndName({
    inviteToken: input.inviteToken,
    normalizedName,
    reservationToken,
    staleBefore: new Date(Date.now() - INVITE_RESERVATION_TTL_MS),
  });
  if (!employee) {
    throw new ApiError({
      code: 'EMPLOYEE_NOT_ELIGIBLE',
      message: '名字不正确，请联系管理员添加',
      status: 400,
    });
  }

  const displayName = employee.nickname ?? employee.legalName ?? input.submittedName.trim();
  let createdBotId: string | null = null;
  let claimCompleted = false;

  try {
    const bot = await createBot({
      desiredState: 'stopped',
      ownerUserId: sourceProfile.userId,
      name: `${displayName}的助理`,
      llmProfileId: sourceProfile.id,
      skipQuota: true,
    });
    createdBotId = bot.id;

    const share = await enableBotQrShare(bot.id);
    const claimed = await repositories.employeeDirectory.claimReservationWithoutUser(reservationToken, bot.id);
    if (!claimed) throw internalError('Failed to complete the employee claim.');
    claimCompleted = true;

    await startBot(bot.id);

    return { botId: bot.id, publicUrl: share.publicUrl };
  } catch (error) {
    if (createdBotId && !claimCompleted) {
      const bot = await repositories.botInstances.findById(createdBotId);
      if (bot) await repositories.workspaces.deleteById(bot.workspaceId);
      await rm(resolveBotInstancePaths(resolveInstancesRoot(), createdBotId).botRoot, {
        force: true,
        recursive: true,
      }).catch(() => undefined);
    }
    if (!claimCompleted) {
      await repositories.employeeDirectory.releaseReservation(reservationToken);
    }
    throw error;
  }
}

function normalizeDirectoryNames(input: { legalName?: string | null; nickname?: string | null }) {
  const legalName = input.legalName?.normalize('NFKC').trim() || null;
  const nickname = input.nickname?.normalize('NFKC').trim() || null;
  if (!legalName && !nickname) throw validationError();
  return {
    legalName,
    nickname,
    normalizedLegalName: legalName ? normalizeEmployeeLookupName(legalName) : null,
    normalizedNickname: nickname ? normalizeEmployeeLookupName(nickname) : null,
  };
}

export function deriveCompanyEmail(name: string | null | undefined): string | null {
  const normalized = name?.normalize('NFKC').trim();
  if (!normalized) return null;
  const characters = Array.from(normalized.replace(/[\s·・]/g, ''));
  if (characters.length < 2 || characters.length > 8) return null;
  if (!/^\p{Script=Han}+$/u.test(characters.join(''))) return null;
  const syllables = pinyin(normalized, { toneType: 'none', type: 'array' })
    .map((value) => value.replace(/[^a-zA-Z]/g, '').toLowerCase());
  if (syllables.length !== characters.length || syllables.some((value) => !value)) return null;
  const localPart = syllables[0] + syllables.slice(1).map((value) => value[0]).join('');
  return localPart ? `${localPart}@example.com` : null;
}

function toEmployeeDirectoryItem(entry: NonNullable<Awaited<ReturnType<ReturnType<typeof getRepositories>['employeeDirectory']['findById']>>>) {
  return {
    id: entry.id,
    legalName: entry.legalName,
    nickname: entry.nickname,
    companyEmail: entry.companyEmail,
    enabled: entry.enabled,
    claimedAt: entry.claimedAt?.toISOString() ?? null,
    claimedBotInstanceId: entry.claimedBotInstanceId,
    claimedByUserId: entry.claimedByUserId,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

function toEmployeeInviteLinkItem(link: NonNullable<Awaited<ReturnType<ReturnType<typeof getRepositories>['employeeInviteLinks']['findById']>>>) {
  return {
    id: link.id,
    token: link.token,
    enabled: link.enabled,
    usageCount: link.usageCount,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
  };
}

function validationError() {
  return new ApiError({ code: 'VALIDATION_ERROR', message: 'Enter a name or nickname.', status: 400 });
}

function notFound(message: string) {
  return new ApiError({ code: 'NOT_FOUND', message, status: 404 });
}

function internalError(message: string) {
  return new ApiError({ code: 'INTERNAL_SERVER_ERROR', message, status: 500 });
}
