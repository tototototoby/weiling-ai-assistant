import { randomUUID } from 'node:crypto';
import type { BotEventRepository, BotInstanceRepository } from '@weiling-ai/db';
import { normalizeTrustedQrCodeUrl, type FastAgentJsonlEvent } from '@weiling-ai/shared';
import { getProcessStartedAt } from './process-identity';
import { calculateRestartPlan } from './restart-policy';

const INVALID_QR_URL_ERROR_CODE = 'INVALID_QR_URL';
const INVALID_QR_URL_ERROR_MESSAGE = 'Rejected untrusted QR code URL.';

export interface ApplyFastAgentEventDependencies {
  botEvents: BotEventRepository;
  botInstances: BotInstanceRepository;
  calculateRestartPlan?: typeof calculateRestartPlan;
}

export interface ApplyFastAgentEventInput {
  botInstanceId: string;
  event: FastAgentJsonlEvent;
}

export async function applyFastAgentEvent(
  dependencies: ApplyFastAgentEventDependencies,
  input: ApplyFastAgentEventInput,
) {
  const observedAt = new Date(input.event.timestamp);
  assertAgentIdMatches(input.botInstanceId, input.event.agentId);

  const currentBot = await dependencies.botInstances.findById(input.botInstanceId);

  if (!currentBot) {
    throw new Error(`Bot instance ${input.botInstanceId} not found.`);
  }

  if (shouldIgnoreStaleProcessEvent(currentBot.processPid, input.event)) {
    return currentBot;
  }

  switch (input.event.type) {
    case 'process_started':
      await dependencies.botInstances.markStarting(input.botInstanceId, {
        heartbeatAt: observedAt,
        processPid: input.event.pid,
        processStartedAt: await resolveProcessStartedAt(input.event.pid, observedAt),
      });

      // A new runtime invalidates the QR published by the previous process.
      if (currentBot.lastQrCodeUrl || currentBot.qrCodeIssuedAt) {
        await dependencies.botInstances.clearQrCode(input.botInstanceId, observedAt);
      }
      break;
    case 'qr_code':
      const qrCodeUrl = getRequiredString(input.event.data, 'qrCodeUrl', input.event.message);
      const trustedQrCodeUrl = normalizeTrustedQrCodeUrl(qrCodeUrl);

      if (!trustedQrCodeUrl) {
        await dependencies.botInstances.recordRuntimeError(input.botInstanceId, {
          errorCode: INVALID_QR_URL_ERROR_CODE,
          errorMessage: INVALID_QR_URL_ERROR_MESSAGE,
          observedAt,
        });
        break;
      }

      if (shouldIgnoreRepeatedQrCode(currentBot, input.event)) {
        return currentBot;
      }

      await dependencies.botInstances.recordQrCode(input.botInstanceId, {
        observedAt,
        qrCodeId: getOptionalString(input.event.data, 'qrCodeId') ?? observedAt.toISOString(),
        qrCodeUrl: trustedQrCodeUrl,
      });
      break;
    case 'login_confirmed':
      await dependencies.botInstances.recordLoginConfirmed(input.botInstanceId, {
        observedAt,
        weixinAccountId: getRequiredString(input.event.data, 'accountId', input.event.message),
      });
      break;
    case 'running':
      await dependencies.botInstances.markRunning(input.botInstanceId, {
        heartbeatAt: observedAt,
        weixinAccountId: getOptionalString(input.event.data, 'accountId') ?? undefined,
      });
      break;
    case 'account_invalid':
      await dependencies.botInstances.markDegraded(input.botInstanceId, {
        heartbeatAt: observedAt,
      });
      break;
    case 'runtime_error':
      await dependencies.botInstances.recordRuntimeError(input.botInstanceId, {
        errorCode: getOptionalString(input.event.data, 'code') ?? 'RUNTIME_ERROR',
        errorMessage: getOptionalString(input.event.data, 'error') ?? input.event.message,
        observedAt,
      });
      break;
    case 'stopping':
      if (currentBot.desiredState === 'stopped' || currentBot.status === 'stopping') {
        await dependencies.botInstances.markStopping(input.botInstanceId, {
          heartbeatAt: observedAt,
        });
      }
      break;
    case 'stopped':
      await applyStoppedEvent(
        dependencies,
        input.botInstanceId,
        currentBot.restartCount,
        currentBot.desiredState,
        currentBot.status,
        currentBot.lastErrorMessage,
        observedAt,
        input.event.message,
      );
      break;
  }

  await dependencies.botEvents.append({
    botInstanceId: input.botInstanceId,
    id: randomUUID(),
    message: input.event.message,
    payloadJson: {
      agentId: input.event.agentId ?? null,
      data: input.event.data,
      pid: input.event.pid,
      timestamp: input.event.timestamp,
    },
    type: input.event.type,
  });

  return dependencies.botInstances.findById(input.botInstanceId);
}

function shouldIgnoreStaleProcessEvent(
  currentProcessPid: number | null,
  event: FastAgentJsonlEvent,
) {
  if (event.type === 'process_started') {
    return false;
  }

  if (currentProcessPid === null) {
    return false;
  }

  return currentProcessPid !== event.pid;
}

function shouldIgnoreRepeatedQrCode(
  currentBot: {
    lastQrCodeUrl: string | null;
    processPid: number | null;
    qrCodeIssuedAt: Date | null;
    qrReissueRequestedAt: Date | null;
  },
  event: FastAgentJsonlEvent,
) {
  if (currentBot.qrReissueRequestedAt) {
    return false;
  }

  if (currentBot.processPid === null || event.pid !== currentBot.processPid) {
    return false;
  }

  // Keep the first QR from this runtime stable until it expires; a fresh QR
  // appears only after the administrator requests a reissue.
  return Boolean(currentBot.lastQrCodeUrl && currentBot.qrCodeIssuedAt);
}

async function applyStoppedEvent(
  dependencies: ApplyFastAgentEventDependencies,
  botInstanceId: string,
  currentRestartCount: number,
  desiredState: 'running' | 'stopped',
  currentStatus: string,
  lastErrorMessage: string | null,
  observedAt: Date,
  message: string,
) {
  if (desiredState === 'stopped') {
    await dependencies.botInstances.markStopped(botInstanceId, {
      observedAt,
    });
    return;
  }

  if (currentStatus === 'stopping') {
    await dependencies.botInstances.markStopped(botInstanceId, {
      observedAt,
    });
    return;
  }

  const restartPlan = (dependencies.calculateRestartPlan ?? calculateRestartPlan)(
    currentRestartCount,
    observedAt,
    {
      keepRetryingAfterThreshold: isTransientNetworkFailure(lastErrorMessage),
    },
  );

  if (restartPlan.kind === 'failed') {
    await dependencies.botInstances.markFailed(botInstanceId, {
      errorCode: 'RUNTIME_ERROR',
      errorMessage: message,
      failedAt: observedAt,
      restartCount: restartPlan.restartCount,
    });
    return;
  }

  await dependencies.botInstances.scheduleRestart(botInstanceId, {
    observedAt,
    restartBackoffUntil: restartPlan.restartBackoffUntil,
    restartCount: restartPlan.restartCount,
  });
}

function isTransientNetworkFailure(errorMessage: string | null) {
  if (!errorMessage) {
    return false;
  }

  return /(?:fetch failed|eai_again|enotfound|econnreset|etimedout|network error|request timed out|timed out)/iu
    .test(errorMessage);
}

function assertAgentIdMatches(botInstanceId: string, agentId: string | undefined) {
  if (!agentId) {
    return;
  }

  if (agentId !== botInstanceId) {
    throw new Error(`FastAgent event agentId mismatch for ${botInstanceId}.`);
  }
}

function getOptionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function getRequiredString(record: Record<string, unknown>, key: string, message: string): string {
  const value = getOptionalString(record, key);

  if (!value) {
    throw new Error(`FastAgent event is missing ${key}: ${message}`);
  }

  return value;
}

async function resolveProcessStartedAt(pid: number, fallbackObservedAt: Date) {
  const actualStartedAt = await getProcessStartedAt(pid);

  if (!actualStartedAt) {
    return fallbackObservedAt;
  }

  return new Date(actualStartedAt);
}
