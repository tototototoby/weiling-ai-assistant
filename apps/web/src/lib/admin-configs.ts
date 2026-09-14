import { z } from 'zod';
import { ApiError } from './api-error';
import { getRepositories, type WebRepositories } from './repositories';

const broadcastSchema = z.object({
  enabled: z.boolean(),
  authorizedEmployeeIds: z.array(z.string().trim().min(1)).max(500),
  rateLimitMinutes: z.number().int().min(1).max(1_440),
}).strict();

const imagegenSchema = z.object({
  enabled: z.boolean(),
  endpoint: z.string().trim().min(1).max(500),
  apiKey: z.string().max(2_000),
  model: z.string().trim().min(1).max(200),
}).strict();

const deliveryHealthSchema = z.object({
  enabled: z.boolean(),
  checkTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  failedThreshold: z.number().int().min(1).max(100),
  stuckHours: z.number().int().min(1).max(720),
  alertEmail: z.string().trim().email().nullable().optional(),
}).strict();

type ConfigRepositories = Pick<
  WebRepositories,
  | 'deliveryHealthChecks'
  | 'globalBroadcastConfigs'
  | 'globalDeliveryHealthConfigs'
  | 'globalImagegenConfigs'
  | 'users'
>;

export interface BroadcastConfigPayload {
  enabled: boolean;
  authorizedEmployeeIds: string[];
  rateLimitMinutes: number;
  revision: number;
  updatedAt: string;
  updatedByEmail: string | null;
}

export interface ImagegenConfigPayload {
  enabled: boolean;
  endpoint: string;
  model: string;
  apiKeyConfigured: boolean;
  revision: number;
  updatedAt: string;
}

export interface DeliveryHealthConfigPayload {
  enabled: boolean;
  checkTime: string;
  failedThreshold: number;
  stuckHours: number;
  alertEmail: string | null;
  revision: number;
  updatedAt: string;
}

export interface DeliveryHealthCheckItem {
  id: string;
  checkDate: string;
  summary: Record<string, unknown>;
  alertSent: boolean;
  createdAt: string;
}

export async function getBroadcastConfig(
  repositories: ConfigRepositories = getRepositories(),
): Promise<BroadcastConfigPayload> {
  const config = await repositories.globalBroadcastConfigs.ensure();
  const updatedBy = config.updatedByUserId
    ? await repositories.users.findById(config.updatedByUserId)
    : null;
  return {
    enabled: config.enabled,
    authorizedEmployeeIds: parseStringArray(config.authorizedEmployeeIdsJson),
    rateLimitMinutes: config.rateLimitMinutes,
    revision: config.revision,
    updatedAt: config.updatedAt.toISOString(),
    updatedByEmail: updatedBy?.email ?? null,
  };
}

export async function updateBroadcastConfig(input: {
  payload: unknown;
  repositories?: ConfigRepositories;
  updatedByUserId: string;
}): Promise<BroadcastConfigPayload> {
  const parsed = broadcastSchema.safeParse(input.payload);
  if (!parsed.success) throw configValidationError('Invalid broadcast config.');
  const repositories = input.repositories ?? getRepositories();
  await repositories.globalBroadcastConfigs.update({
    enabled: parsed.data.enabled,
    authorizedEmployeeIds: parsed.data.authorizedEmployeeIds,
    rateLimitMinutes: parsed.data.rateLimitMinutes,
    updatedByUserId: input.updatedByUserId,
  });
  return getBroadcastConfig(repositories);
}

export async function getImagegenConfig(
  repositories: ConfigRepositories = getRepositories(),
): Promise<ImagegenConfigPayload> {
  const config = await repositories.globalImagegenConfigs.ensure();
  return {
    enabled: config.enabled,
    endpoint: config.endpoint,
    model: config.model,
    apiKeyConfigured: Boolean(config.apiKey),
    revision: config.revision,
    updatedAt: config.updatedAt.toISOString(),
  };
}

export async function updateImagegenConfig(input: {
  payload: unknown;
  repositories?: ConfigRepositories;
  updatedByUserId: string;
}): Promise<ImagegenConfigPayload> {
  const parsed = imagegenSchema.safeParse(input.payload);
  if (!parsed.success) throw configValidationError('Invalid image generation config.');
  const repositories = input.repositories ?? getRepositories();
  await repositories.globalImagegenConfigs.update({
    enabled: parsed.data.enabled,
    endpoint: parsed.data.endpoint,
    apiKey: parsed.data.apiKey,
    model: parsed.data.model,
    updatedByUserId: input.updatedByUserId,
  });
  return getImagegenConfig(repositories);
}

export async function getDeliveryHealthConfig(
  repositories: ConfigRepositories = getRepositories(),
): Promise<DeliveryHealthConfigPayload> {
  const config = await repositories.globalDeliveryHealthConfigs.ensure();
  return {
    enabled: config.enabled,
    checkTime: config.checkTime,
    failedThreshold: config.failedThreshold,
    stuckHours: config.stuckHours,
    alertEmail: config.alertEmail,
    revision: config.revision,
    updatedAt: config.updatedAt.toISOString(),
  };
}

export async function updateDeliveryHealthConfig(input: {
  payload: unknown;
  repositories?: ConfigRepositories;
  updatedByUserId: string;
}): Promise<DeliveryHealthConfigPayload> {
  const parsed = deliveryHealthSchema.safeParse(input.payload);
  if (!parsed.success) throw configValidationError('Invalid delivery health config.');
  const repositories = input.repositories ?? getRepositories();
  await repositories.globalDeliveryHealthConfigs.update({
    enabled: parsed.data.enabled,
    checkTime: parsed.data.checkTime,
    failedThreshold: parsed.data.failedThreshold,
    stuckHours: parsed.data.stuckHours,
    alertEmail: parsed.data.alertEmail ?? null,
    updatedByUserId: input.updatedByUserId,
  });
  return getDeliveryHealthConfig(repositories);
}

export async function listDeliveryHealthChecks(
  repositories: ConfigRepositories = getRepositories(),
): Promise<DeliveryHealthCheckItem[]> {
  return (await repositories.deliveryHealthChecks.listRecent(30)).map((check) => ({
    id: check.id,
    checkDate: check.checkDate,
    summary: parseSummary(check.summaryJson),
    alertSent: check.alertSent,
    createdAt: check.createdAt.toISOString(),
  }));
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function parseSummary(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function configValidationError(message: string): ApiError {
  return new ApiError({ code: 'CONFIG_VALIDATION_ERROR', message, status: 400 });
}
