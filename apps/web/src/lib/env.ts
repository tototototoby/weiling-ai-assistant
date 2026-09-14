import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  parseSandboxRuntimePoolDefaults,
  resolveInstancesRootPath,
  type SandboxRuntimePoolDefaults,
} from '@weiling-ai/shared';
import { z } from 'zod';

const WEB_REQUIRED_ENV_KEYS = ['DATABASE_URL', 'APP_BASE_URL', 'BETTER_AUTH_SECRET'] as const;
const WEB_OPTIONAL_ENV_KEYS = ['WEB_ADMIN_EMAILS', 'WEB_USER_BOT_LIMIT'] as const;
const SRT_POOL_ENV_KEYS = [
  'SRT_DEFAULT_ALLOW_READ',
  'SRT_DEFAULT_ALLOW_WRITE',
  'SRT_DEFAULT_DENIED_DOMAINS',
  'SRT_DEFAULT_DENY_READ',
  'SRT_DEFAULT_DENY_WRITE',
  'SRT_DEFAULT_HEALTH_CHECK_INTERVAL_MS',
  'SRT_DEFAULT_MAX_CONCURRENT_INIT',
  'SRT_DEFAULT_MIN_READY_PROCESSES',
  'SRT_DEFAULT_POOL_SIZE',
  'SRT_DEFAULT_PORT_RANGE_WIDTH',
  'SRT_DEFAULT_SESSION_TIMEOUT_MS',
  'SRT_PORT_BASE',
  'SRT_POOL_STATUS_FILE',
  'SRT_PROXY_PORT_BASE',
  'SRT_WORKSPACE_BASE_ROOT',
] as const;
const WEB_ENV_FALLBACK_KEYS = [...WEB_REQUIRED_ENV_KEYS, ...WEB_OPTIONAL_ENV_KEYS, ...SRT_POOL_ENV_KEYS] as const;

const nonNegativeIntegerEnv = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim();
  return normalized === '' ? undefined : Number(normalized);
}, z.number().int().min(0).default(0));

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_BASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(1),
  WEB_ADMIN_EMAILS: z.string().default(''),
  WEB_USER_BOT_LIMIT: nonNegativeIntegerEnv,
});

export type WebEnv = z.infer<typeof envSchema> & {
  srtPoolDefaults: SandboxRuntimePoolDefaults;
};

let cachedEnv: WebEnv | null = null;

export function getEnv(): WebEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  loadWorkspaceEnvFileIfNeeded(WEB_ENV_FALLBACK_KEYS);
  cachedEnv = {
    ...envSchema.parse(process.env),
    srtPoolDefaults: parseSandboxRuntimePoolDefaults(process.env),
  };
  return cachedEnv;
}

export function getUserBotLimit(): number | null {
  const { WEB_USER_BOT_LIMIT } = getEnv();
  return WEB_USER_BOT_LIMIT > 0 ? WEB_USER_BOT_LIMIT : null;
}

export function getWorkspaceRoot(startDir: string = process.cwd()): string {
  let currentDir = path.resolve(startDir);

  while (true) {
    if (hasWorkspaceMarker(currentDir)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error('Unable to locate workspace root from current directory.');
    }

    currentDir = parentDir;
  }
}

function hasWorkspaceMarker(directory: string): boolean {
  return existsSync(path.join(directory, 'pnpm-workspace.yaml'));
}

function loadWorkspaceEnvFileIfNeeded(requiredKeys: readonly string[]) {
  if (hasAllRequiredEnv(process.env, requiredKeys)) {
    return;
  }

  const envFilePath = path.join(getWorkspaceRoot(), '.env');

  if (!existsSync(envFilePath)) {
    return;
  }

  process.loadEnvFile(envFilePath);
}

function hasAllRequiredEnv(env: NodeJS.ProcessEnv, requiredKeys: readonly string[]): boolean {
  return requiredKeys.every((key) => Boolean(env[key]));
}

export function resolveInstancesRoot(): string {
  loadWorkspaceEnvFileIfNeeded(['INSTANCES_ROOT']);
  return resolveInstancesRootPath(getWorkspaceRoot(), process.env.INSTANCES_ROOT);
}

export function resolveSrtPoolStatusFile(): string {
  loadWorkspaceEnvFileIfNeeded(['SRT_POOL_STATUS_FILE']);
  return resolveWorkspaceRelativePath(
    process.env.SRT_POOL_STATUS_FILE,
    path.join('storage', 'sandbox-runtime-private', 'srt-pool-status.json'),
  );
}

function resolveWorkspaceRelativePath(configuredPath: string | undefined, fallbackRelativePath: string): string {
  const nextPath = configuredPath?.trim() || fallbackRelativePath;
  return path.isAbsolute(nextPath)
    ? nextPath
    : path.join(/* turbopackIgnore: true */ getWorkspaceRoot(), nextPath);
}
