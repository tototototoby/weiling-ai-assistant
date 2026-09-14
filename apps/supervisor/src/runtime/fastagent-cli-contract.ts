import { accessSync, constants as fsConstants, existsSync } from 'node:fs';
import {
  FastAgentJsonlEventSchema,
  type FastAgentJsonlEvent,
} from '@weiling-ai/shared';
import {
  resolveFastAgentBinaryPath,
  type FastAgentBinaryResolutionOptions,
} from './resolve-fastagent-binary-path';

const WEIXIN_CHANNEL_ARGS = ['--channel', 'weixin'] as const;
const JSONL_OUTPUT_ARGS = ['--output', 'jsonl'] as const;
const REMOTE_SANDBOX_ARGS = ['--sandbox', 'remote', '--sandbox-url'] as const;
const FASTAGENT_CONTRACT_SMOKE_MISSING_ENV_REASON = 'FASTAGENT_API_KEY, FASTAGENT_MODEL or FASTAGENT_DEFAULT_MODEL, and FASTAGENT_PROVIDER or FASTAGENT_DEFAULT_PROVIDER are required for FastAgent contract smoke.';

export interface FastAgentCliInvocation {
  args: string[];
  command: string;
}

export type FastAgentContractSmokeAvailability =
  | {
      binaryPath: string;
      enabled: true;
    }
  | {
      enabled: false;
      reason: string;
    };

export function buildRuntimeJsonlInvocation(
  binaryPath: string,
  sandboxUrl: string,
): FastAgentCliInvocation {
  return {
    args: [
      ...WEIXIN_CHANNEL_ARGS,
      ...REMOTE_SANDBOX_ARGS,
      sandboxUrl,
      ...JSONL_OUTPUT_ARGS,
    ],
    command: binaryPath,
  };
}

export function buildBareJsonlInvocation(binaryPath: string): FastAgentCliInvocation {
  return {
    args: [...JSONL_OUTPUT_ARGS],
    command: binaryPath,
  };
}

export function parseFastAgentJsonlOutput(stdout: string): FastAgentJsonlEvent[] {
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => parseFastAgentJsonlLine(line, index + 1));
}

export function shouldRunFastAgentContractSmoke(
  env: NodeJS.ProcessEnv = process.env,
  options: FastAgentBinaryResolutionOptions = {},
): FastAgentContractSmokeAvailability {
  const binaryPath = resolveFastAgentBinaryPath(env, options);

  if (!binaryPath) {
    return {
      enabled: false,
      reason: 'Unable to locate FastAgent CLI binary. Install @fastagent/cli in apps/supervisor or set FASTAGENT_BINARY_PATH.',
    };
  }

  if (!existsSync(binaryPath)) {
    return {
      enabled: false,
      reason: `FASTAGENT_BINARY_PATH does not exist: ${binaryPath}`,
    };
  }

  try {
    accessSync(binaryPath, fsConstants.X_OK);
  } catch {
    return {
      enabled: false,
      reason: `FASTAGENT_BINARY_PATH is not executable: ${binaryPath}`,
    };
  }

  if (!hasRequiredContractSmokeEnv(env)) {
    return {
      enabled: false,
      reason: FASTAGENT_CONTRACT_SMOKE_MISSING_ENV_REASON,
    };
  }

  return {
    binaryPath,
    enabled: true,
  };
}

function hasRequiredContractSmokeEnv(env: NodeJS.ProcessEnv) {
  return Boolean(env.FASTAGENT_API_KEY)
    && Boolean(env.FASTAGENT_MODEL || env.FASTAGENT_DEFAULT_MODEL)
    && Boolean(env.FASTAGENT_PROVIDER || env.FASTAGENT_DEFAULT_PROVIDER);
}

function parseFastAgentJsonlLine(line: string, lineNumber: number): FastAgentJsonlEvent {
  let parsed: unknown;

  try {
    parsed = JSON.parse(line) as unknown;
  } catch (error) {
    throw new Error(
      `Invalid FastAgent JSONL on line ${lineNumber}: ${
        error instanceof Error ? error.message : 'Unable to parse JSON.'
      }`,
    );
  }

  const result = FastAgentJsonlEventSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(
      `Invalid FastAgent event on line ${lineNumber}: ${result.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ')}`,
    );
  }

  return result.data;
}
