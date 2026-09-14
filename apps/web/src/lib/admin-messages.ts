import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ADMIN_MESSAGE_ASSISTANT_NAME_MAX_LENGTH,
  ADMIN_MESSAGE_COPY_DEFAULTS,
  ADMIN_MESSAGE_COPY_KEYS,
  ADMIN_MESSAGE_COPY_MAX_LENGTH,
  type AdminMessageCopyConfig,
  validateAdminMessageCopyValue,
} from './admin-message-copy';
import { ApiError } from './api-error';
import { getWorkspaceRoot } from './env';
import { readGlobalEmailSecret, writeGlobalEmailSecret } from './global-email-secret';
import type { WebRepositories } from './repositories';

function messageCopySchema(
  key: (typeof ADMIN_MESSAGE_COPY_KEYS)[number],
  maxLength = ADMIN_MESSAGE_COPY_MAX_LENGTH,
) {
  return z.string().trim().min(1).max(maxLength).superRefine((value, context) => {
    const error = validateAdminMessageCopyValue(key, value);
    if (error) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid message copy: ${error}.` });
    }
  });
}

const adminMessagePayloadSchema = z.object({
  botInstanceIds: z.array(z.string().trim().min(1)).optional(),
  channel: z.enum(['im', 'email', 'both']).default('im'),
  message: z.string().trim().min(1).max(4_000),
  subject: z.string().trim().min(1).max(200).default('微Link · 微灵 AI 助手通知'),
  scope: z.enum(['all', 'selected']),
}).strict().superRefine((value, context) => {
  if (value.scope === 'selected' && (!value.botInstanceIds || value.botInstanceIds.length === 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'botInstanceIds are required for selected scope.',
      path: ['botInstanceIds'],
    });
  }
});

const adminMessageConfigPayloadSchema = z.object({
  deferFailedUntilUserActive: z.boolean(),
  assistantName: messageCopySchema('assistantName', ADMIN_MESSAGE_ASSISTANT_NAME_MAX_LENGTH),
  mealConsentPrompt: messageCopySchema('mealConsentPrompt'),
  mealRainReminder: messageCopySchema('mealRainReminder'),
  mealStandardReminder: messageCopySchema('mealStandardReminder'),
  morningBriefingIntro: messageCopySchema('morningBriefingIntro'),
  processingAck: messageCopySchema('processingAck'),
  wecomAck: messageCopySchema('wecomAck'),
  wecomDuplicate: messageCopySchema('wecomDuplicate'),
  wecomCompleted: messageCopySchema('wecomCompleted'),
  wecomFailure: messageCopySchema('wecomFailure'),
  wecomUnbound: messageCopySchema('wecomUnbound'),
  wecomUnsupported: messageCopySchema('wecomUnsupported'),
  wecomGroupUnsupported: messageCopySchema('wecomGroupUnsupported'),
  wecomBindingNamePrompt: messageCopySchema('wecomBindingNamePrompt'),
  wecomBindingNameInvalid: messageCopySchema('wecomBindingNameInvalid'),
  wecomBindingSuccess: messageCopySchema('wecomBindingSuccess'),
  email: z.object({
    enabled: z.boolean(),
    password: z.string().max(500).optional(),
    senderEmail: z.string().trim().email().nullable(),
    senderName: z.string().trim().min(1).max(100),
    smtpHost: z.string().trim().min(1).max(255),
    smtpPort: z.number().int().min(1).max(65_535),
    smtpSecurity: z.enum(['ssl', 'starttls']),
  }).strict().optional(),
}).strict();

type AdminMessageRecord = Awaited<ReturnType<WebRepositories['adminMessageDeliveries']['listRecent']>>[number];

export interface AdminMessageTarget {
  botId: string;
  botName: string;
  ownerEmail: string | null;
  ownerUserId: string;
  companyEmail?: string | null;
  runtimeStatus: string;
}

export interface AdminMessageDeliveryItem {
  attemptCount: number;
  batchId: string;
  botId: string;
  botName: string;
  createdAt: string;
  lastError: string | null;
  message: string;
  ownerEmail: string | null;
  sentAt: string | null;
  status: string;
  updatedAt: string;
}

export interface AdminMessagesPayload {
  config: AdminMessageCopyConfig & {
    deferFailedUntilUserActive: boolean;
    observedRevision: number | null;
    revision: number;
    updatedAt: string;
    updatedByEmail: string | null;
  };
  deliveries: AdminMessageDeliveryItem[];
  emailConfig: {
    enabled: boolean;
    observedRevision: number | null;
    passwordConfigured: boolean;
    revision: number;
    senderEmail: string | null;
    senderName: string;
    smtpHost: string;
    smtpPort: number;
    smtpSecurity: 'ssl' | 'starttls';
    updatedAt: string;
  };
  emailDeliveries: Array<{
    attemptCount: number;
    botId: string;
    botName: string;
    createdAt: string;
    lastError: string | null;
    message: string;
    recipientEmail: string;
    sentAt: string | null;
    source: string;
    status: string;
    subject: string;
    updatedAt: string;
  }>;
  targets: AdminMessageTarget[];
}

type AdminMessageRepositories = Pick<
  WebRepositories,
  'adminMessageDeliveries' | 'botInstances' | 'globalAdminMessageConfigs' | 'users'
> & Partial<Pick<WebRepositories, 'emailDeliveries' | 'employeeDirectory' | 'globalEmailConfigs'>>;

export async function listAdminMessages(
  repositories: AdminMessageRepositories,
): Promise<AdminMessagesPayload> {
  const [bots, config, records, employees, emailConfig, emailRecords, emailSecret] = await Promise.all([
    repositories.botInstances.listAllForAdministration(),
    repositories.globalAdminMessageConfigs.ensure(),
    repositories.adminMessageDeliveries.listRecent(200),
    repositories.employeeDirectory?.listAll() ?? [],
    repositories.globalEmailConfigs?.ensure() ?? null,
    repositories.emailDeliveries?.listRecent(200) ?? [],
    repositories.globalEmailConfigs ? readGlobalEmailSecret(getWorkspaceRoot()) : null,
  ]);
  const ownerIds = Array.from(new Set(bots.map((bot) => bot.ownerUserId)));
  if (config.updatedByUserId && !ownerIds.includes(config.updatedByUserId)) {
    ownerIds.push(config.updatedByUserId);
  }
  const owners = await Promise.all(ownerIds.map((id) => repositories.users.findById(id)));
  const emailById = new Map(ownerIds.map((id, index) => [id, owners[index]?.email ?? null]));
  const botById = new Map(bots.map((bot) => [bot.id, bot]));
  const employeeByBotId = new Map(employees
    .filter((employee) => employee.claimedBotInstanceId)
    .map((employee) => [employee.claimedBotInstanceId!, employee]));
  const configuredCopy = config as Partial<AdminMessageCopyConfig>;

  return {
    config: {
      assistantName: configuredCopy.assistantName ?? ADMIN_MESSAGE_COPY_DEFAULTS.assistantName,
      deferFailedUntilUserActive: config.deferFailedUntilUserActive,
      mealConsentPrompt: configuredCopy.mealConsentPrompt ?? ADMIN_MESSAGE_COPY_DEFAULTS.mealConsentPrompt,
      mealRainReminder: configuredCopy.mealRainReminder ?? ADMIN_MESSAGE_COPY_DEFAULTS.mealRainReminder,
      mealStandardReminder: configuredCopy.mealStandardReminder ?? ADMIN_MESSAGE_COPY_DEFAULTS.mealStandardReminder,
      morningBriefingIntro: configuredCopy.morningBriefingIntro ?? ADMIN_MESSAGE_COPY_DEFAULTS.morningBriefingIntro,
      observedRevision: config.observedRevision,
      processingAck: configuredCopy.processingAck ?? ADMIN_MESSAGE_COPY_DEFAULTS.processingAck,
      revision: config.revision,
      updatedAt: config.updatedAt.toISOString(),
      updatedByEmail: config.updatedByUserId
        ? emailById.get(config.updatedByUserId) ?? null
        : null,
      wecomAck: configuredCopy.wecomAck ?? ADMIN_MESSAGE_COPY_DEFAULTS.wecomAck,
      wecomBindingNameInvalid: configuredCopy.wecomBindingNameInvalid ?? ADMIN_MESSAGE_COPY_DEFAULTS.wecomBindingNameInvalid,
      wecomBindingNamePrompt: configuredCopy.wecomBindingNamePrompt ?? ADMIN_MESSAGE_COPY_DEFAULTS.wecomBindingNamePrompt,
      wecomBindingSuccess: configuredCopy.wecomBindingSuccess ?? ADMIN_MESSAGE_COPY_DEFAULTS.wecomBindingSuccess,
      wecomCompleted: configuredCopy.wecomCompleted ?? ADMIN_MESSAGE_COPY_DEFAULTS.wecomCompleted,
      wecomDuplicate: configuredCopy.wecomDuplicate ?? ADMIN_MESSAGE_COPY_DEFAULTS.wecomDuplicate,
      wecomFailure: configuredCopy.wecomFailure ?? ADMIN_MESSAGE_COPY_DEFAULTS.wecomFailure,
      wecomGroupUnsupported: configuredCopy.wecomGroupUnsupported ?? ADMIN_MESSAGE_COPY_DEFAULTS.wecomGroupUnsupported,
      wecomUnbound: configuredCopy.wecomUnbound ?? ADMIN_MESSAGE_COPY_DEFAULTS.wecomUnbound,
      wecomUnsupported: configuredCopy.wecomUnsupported ?? ADMIN_MESSAGE_COPY_DEFAULTS.wecomUnsupported,
    },
    deliveries: records
      .map((record) => toDeliveryItem(record, botById.get(record.botInstanceId), emailById))
      .filter((item): item is AdminMessageDeliveryItem => item !== null),
    emailConfig: emailConfig ? {
      enabled: emailConfig.enabled,
      observedRevision: emailConfig.observedRevision,
      passwordConfigured: Boolean(emailSecret),
      revision: emailConfig.revision,
      senderEmail: emailConfig.senderEmail,
      senderName: emailConfig.senderName,
      smtpHost: emailConfig.smtpHost,
      smtpPort: emailConfig.smtpPort,
      smtpSecurity: emailConfig.smtpSecurity,
      updatedAt: emailConfig.updatedAt.toISOString(),
    } : {
      enabled: false,
      observedRevision: null,
      passwordConfigured: false,
      revision: 1,
      senderEmail: null,
      senderName: '微Link · 微灵 AI 助手',
      smtpHost: 'smtp.exmail.qq.com',
      smtpPort: 465,
      smtpSecurity: 'ssl',
      updatedAt: config.updatedAt.toISOString(),
    },
    emailDeliveries: emailRecords.map((record) => ({
      attemptCount: record.attemptCount,
      botId: record.botInstanceId,
      botName: botById.get(record.botInstanceId)?.name ?? record.botInstanceId,
      createdAt: record.createdAt.toISOString(),
      lastError: record.lastError,
      message: record.message,
      recipientEmail: record.recipientEmail,
      sentAt: record.sentAt?.toISOString() ?? null,
      source: record.source,
      status: record.status,
      subject: record.subject,
      updatedAt: record.updatedAt.toISOString(),
    })),
    targets: bots.map((bot) => ({
      botId: bot.id,
      botName: bot.name,
      companyEmail: employeeByBotId.get(bot.id)?.companyEmail ?? null,
      ownerEmail: emailById.get(bot.ownerUserId) ?? null,
      ownerUserId: bot.ownerUserId,
      runtimeStatus: bot.status,
    })),
  };
}

export async function updateAdminMessageConfig(input: {
  payload: unknown;
  repositories: AdminMessageRepositories;
  updatedByUserId?: string;
}): Promise<AdminMessagesPayload> {
  const parsed = adminMessageConfigPayloadSchema.safeParse(input.payload);
  if (!parsed.success) throw invalidConfigError();

  const { email, ...messageConfig } = parsed.data;
  if (email) {
    if (!input.repositories.globalEmailConfigs || !input.updatedByUserId) throw invalidConfigError();
    const currentSecret = await readGlobalEmailSecret(getWorkspaceRoot());
    if (email.enabled && !email.password && !currentSecret) {
      throw new ApiError({
        code: 'EMAIL_PASSWORD_MISSING',
        message: 'Configure the enterprise email password before enabling email delivery.',
        status: 400,
      });
    }
    await input.repositories.globalEmailConfigs.ensure();
    if (email.password) {
      await writeGlobalEmailSecret(getWorkspaceRoot(), email.password);
    }
    await input.repositories.globalEmailConfigs.update({
      enabled: email.enabled,
      senderEmail: email.senderEmail,
      senderName: email.senderName,
      smtpHost: email.smtpHost,
      smtpPort: email.smtpPort,
      smtpSecurity: email.smtpSecurity,
      updatedByUserId: input.updatedByUserId,
    });
  }
  await input.repositories.globalAdminMessageConfigs.update({
    ...messageConfig,
    updatedByUserId: input.updatedByUserId,
  });
  return listAdminMessages(input.repositories);
}

export async function createAdminMessageBatch(input: {
  createdByUserId: string;
  payload: unknown;
  repositories: AdminMessageRepositories;
}): Promise<AdminMessagesPayload> {
  const parsed = adminMessagePayloadSchema.safeParse(input.payload);
  if (!parsed.success) throw invalidMessageError();

  const bots = await input.repositories.botInstances.listAllForAdministration();
  const targetIds = parsed.data.scope === 'all'
    ? bots.map((bot) => bot.id)
    : Array.from(new Set(parsed.data.botInstanceIds ?? []));
  const botById = new Map(bots.map((bot) => [bot.id, bot]));
  if (targetIds.length === 0 || targetIds.some((id) => !botById.has(id))) {
    throw new ApiError({ code: 'ADMIN_MESSAGE_TARGET_NOT_FOUND', message: 'One or more target bots were not found.', status: 404 });
  }

  const batchId = randomUUID();
  if (parsed.data.channel === 'email' || parsed.data.channel === 'both') {
    if (!input.repositories.emailDeliveries || !input.repositories.employeeDirectory) {
      throw new ApiError({ code: 'EMAIL_DELIVERY_UNAVAILABLE', message: 'Email delivery is not available.', status: 503 });
    }
    const employees = await input.repositories.employeeDirectory.listAll();
    const emailByBotId = new Map(employees
      .filter((employee) => employee.claimedBotInstanceId && employee.companyEmail)
      .map((employee) => [employee.claimedBotInstanceId!, employee]));
    const missing = targetIds.filter((id) => !emailByBotId.get(id)?.companyEmail);
    if (missing.length > 0) {
      throw new ApiError({ code: 'EMAIL_RECIPIENT_MISSING', message: 'One or more selected employees do not have a company email.', status: 400 });
    }
    await input.repositories.emailDeliveries.createBatch(targetIds.map((botInstanceId) => {
      const employee = emailByBotId.get(botInstanceId)!;
      return {
        botInstanceId,
        createdByUserId: input.createdByUserId,
        id: randomUUID(),
        message: parsed.data.message,
        recipientEmail: employee.companyEmail!,
        recipientUserId: employee.claimedByUserId ?? botById.get(botInstanceId)!.ownerUserId,
        semanticKey: `admin-email:${batchId}:${botInstanceId}`,
        source: 'admin' as const,
        subject: parsed.data.subject,
      };
    }));
  }

  if (parsed.data.channel === 'im' || parsed.data.channel === 'both') {
    await input.repositories.adminMessageDeliveries.createBatch(targetIds.map((botInstanceId) => ({
      batchId,
      botInstanceId,
      createdByUserId: input.createdByUserId,
      id: randomUUID(),
      message: parsed.data.message,
      recipientUserId: botById.get(botInstanceId)!.ownerUserId,
    })));
  }

  return listAdminMessages(input.repositories);
}

function toDeliveryItem(
  record: AdminMessageRecord,
  bot: Awaited<ReturnType<WebRepositories['botInstances']['findById']>> | undefined,
  emailById: Map<string, string | null>,
): AdminMessageDeliveryItem | null {
  if (!bot) return null;
  return {
    attemptCount: record.attemptCount,
    batchId: record.batchId,
    botId: record.botInstanceId,
    botName: bot.name,
    createdAt: record.createdAt.toISOString(),
    lastError: record.lastError,
    message: record.message,
    ownerEmail: emailById.get(bot.ownerUserId) ?? null,
    sentAt: record.sentAt?.toISOString() ?? null,
    status: record.status,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function invalidMessageError(): ApiError {
  return new ApiError({
    code: 'ADMIN_MESSAGE_INVALID',
    message: 'Enter a message and choose valid recipients.',
    status: 400,
  });
}

function invalidConfigError(): ApiError {
  return new ApiError({
    code: 'ADMIN_MESSAGE_CONFIG_INVALID',
    message: 'Enter valid delivery settings and non-empty global message copy.',
    status: 400,
  });
}
