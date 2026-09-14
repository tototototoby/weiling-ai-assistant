import type { UserLlmProfileRepository } from '@weiling-ai/db';
import type { SpawnableBotInstance } from './spawn-fastagent';

export interface ResolvedFastAgentRuntimeConfig {
  apiKey: string;
  apiType: string | null;
  baseUrl: string | null;
  model: string;
  provider: string;
}

export class LlmProfileRequiredError extends Error {
  readonly code = 'LLM_PROFILE_REQUIRED';

  constructor() {
    super('Bot LLM profile is required.');
    this.name = 'LlmProfileRequiredError';
  }
}

export class LlmProfileInvalidError extends Error {
  readonly code = 'LLM_PROFILE_INVALID';

  constructor(profileId: string) {
    super(`Bot LLM profile is invalid or inaccessible: ${profileId}.`);
    this.name = 'LlmProfileInvalidError';
  }
}

export async function resolveFastAgentRuntimeConfig(input: {
  botInstance: SpawnableBotInstance;
  userLlmProfiles: UserLlmProfileRepository;
}): Promise<ResolvedFastAgentRuntimeConfig> {
  const profileId = input.botInstance.llmConfigId;

  if (!profileId) {
    throw new LlmProfileRequiredError();
  }

  const profile = await input.userLlmProfiles.findByIdForUser(profileId, input.botInstance.ownerUserId);

  if (!profile) {
    throw new LlmProfileInvalidError(profileId);
  }

  if (!hasRequiredRuntimeConfig(profile.provider)
    || !hasRequiredRuntimeConfig(profile.model)
    || !hasRequiredRuntimeConfig(profile.apiKey)) {
    throw new LlmProfileInvalidError(profileId);
  }

  return {
    apiKey: profile.apiKey,
    apiType: profile.apiType,
    baseUrl: profile.baseUrl,
    model: profile.model,
    provider: profile.provider,
  };
}

function hasRequiredRuntimeConfig(value: string) {
  return value.trim().length > 0;
}
