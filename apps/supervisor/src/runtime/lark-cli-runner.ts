import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import type { SupervisorConfig } from '../config';

const SAFE_INHERITED_ENV_KEYS = [
  'ALL_PROXY',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'NODE_EXTRA_CA_CERTS',
  'NO_PROXY',
  'PATH',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'TEMP',
  'TMP',
  'TMPDIR',
  'TZ',
  'all_proxy',
  'http_proxy',
  'https_proxy',
  'no_proxy',
] as const;

const DEFAULT_LARK_CLI_TIMEOUT_MS = 60_000;

export interface SpawnLarkCliInput {
  args: string[];
  config: SupervisorConfig;
  homeDir: string;
}

export interface RunLarkCliOnceInput extends SpawnLarkCliInput {
  cwd?: string;
  timeoutMs?: number;
}

export function spawnLarkCli(input: SpawnLarkCliInput): ChildProcess {
  return spawn(input.config.larkCliPath, input.args, {
    env: buildLarkCliEnv(input.config, input.homeDir),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export async function runLarkCliOnce(input: RunLarkCliOnceInput): Promise<void> {
  await mkdir(input.homeDir, { recursive: true });
  const timeoutMs = input.timeoutMs ?? DEFAULT_LARK_CLI_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const child = spawn(input.config.larkCliPath, input.args, {
      cwd: input.cwd,
      env: buildLarkCliEnv(input.config, input.homeDir),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`lark-cli timed out after ${timeoutMs}ms: ${input.args.join(' ')}`));
    }, timeoutMs);

    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (exitCode, signal) => {
      clearTimeout(timer);
      if (exitCode === 0) {
        resolve();
        return;
      }
      reject(new Error(
        `lark-cli exited with code ${exitCode} (signal ${signal ?? 'none'}): `
        + `${stderr.trim() || stdout.trim()}`,
      ));
    });
  });
}

export async function runLarkCliCapture(input: RunLarkCliOnceInput): Promise<string> {
  await mkdir(input.homeDir, { recursive: true });
  const timeoutMs = input.timeoutMs ?? DEFAULT_LARK_CLI_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const child = spawn(input.config.larkCliPath, input.args, {
      cwd: input.cwd,
      env: buildLarkCliEnv(input.config, input.homeDir),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`lark-cli timed out after ${timeoutMs}ms: ${input.args.join(' ')}`));
    }, timeoutMs);

    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (exitCode, signal) => {
      clearTimeout(timer);
      if (exitCode === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(
        `lark-cli exited with code ${exitCode} (signal ${signal ?? 'none'}): `
        + `${stderr.trim() || stdout.trim()}`,
      ));
    });
  });
}

function buildLarkCliEnv(config: SupervisorConfig, homeDir: string): NodeJS.ProcessEnv {
  return {
    ...pickSafeInheritedEnv(process.env),
    HOME: homeDir,
  };
}

function pickSafeInheritedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(env)) {
    if (!value) continue;
    if (SAFE_INHERITED_ENV_KEYS.includes(key as typeof SAFE_INHERITED_ENV_KEYS[number])) {
      nextEnv[key] = value;
    }
  }

  return nextEnv;
}
