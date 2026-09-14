import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { getSupervisorConfig } from '../config';

const tempDirs: string[] = [];
const execFile = promisify(execFileCallback);

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('getSupervisorConfig', () => {
  it('loads required local dev env from the workspace root .env file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-supervisor-config-'));
    tempDirs.push(dir);

    const appDir = join(dir, 'apps', 'supervisor');
    const fastagentBinaryPath = join(appDir, 'node_modules', '.bin', 'fastagent');
    await mkdir(appDir, { recursive: true });
    await mkdir(join(appDir, 'node_modules', '.bin'), { recursive: true });
    await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n  - packages/*\n');
    await writeFile(
      join(dir, '.env'),
      [
        'DATABASE_URL=file:./storage/sqlite/test.sqlite',
        'FASTAGENT_API_KEY=test-fastagent-key',
        'FASTAGENT_DEFAULT_MODEL=gpt-5.4',
        'FASTAGENT_DEFAULT_PROVIDER=openai',
        'INSTANCES_ROOT=./storage/instances-local-dev',
        'RECONCILE_INTERVAL_MS=4321',
        'RECONCILE_STALL_TIMEOUT_MS=9876',
        'SRT_DEFAULT_MIN_READY_PROCESSES=2',
        'SRT_DEFAULT_POOL_SIZE=5',
      ].join('\n'),
    );
    await writeFile(fastagentBinaryPath, '#!/bin/sh\nexit 0\n');
    await chmod(fastagentBinaryPath, 0o755);

    const config = await loadConfigInIsolatedProcess(appDir);

    expect(config).toMatchObject({
      databaseUrl: 'file:./storage/sqlite/test.sqlite',
      fastagentBinaryPath,
      instancesRoot: join(dir, 'storage', 'instances-local-dev'),
      reconcileIntervalMs: 4321,
      reconcileStallTimeoutMs: 9876,
      sandboxApiKey: null,
      sandboxUrl: null,
      srtPoolConfigFile: join(dir, 'storage', 'sandbox-runtime-private', 'srt-pools.json'),
      srtPoolStatusFile: join(dir, 'storage', 'sandbox-runtime-private', 'srt-pool-status.json'),
      srtServiceHost: 'sandbox-runtime',
      srtWorkspaceMapDir: join(dir, 'storage', 'sandbox-runtime-private', 'workspace-map'),
      workspaceRoot: dir,
    });
    expect(config.srtPoolDefaults).toMatchObject({
      minReadyProcesses: 2,
      poolSize: 5,
      sessionTimeoutMs: 600_000,
    });
    expect(config).not.toHaveProperty('fastagentApiKey');
    expect(config).not.toHaveProperty('fastagentApiType');
    expect(config).not.toHaveProperty('fastagentBaseUrl');
    expect(config).not.toHaveProperty('fastagentDefaultModel');
    expect(config).not.toHaveProperty('fastagentDefaultProvider');
  });

  it('still loads optional workspace .env values when required runtime env already exists in process.env', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-supervisor-config-optional-env-'));
    tempDirs.push(dir);

    const appDir = join(dir, 'apps', 'supervisor');
    const fastagentBinaryPath = join(appDir, 'node_modules', '.bin', 'fastagent');
    await mkdir(appDir, { recursive: true });
    await mkdir(join(appDir, 'node_modules', '.bin'), { recursive: true });
    await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n  - packages/*\n');
    await writeFile(
      join(dir, '.env'),
      [
        'DATABASE_URL=file:./storage/sqlite/optional.sqlite',
        'INSTANCES_ROOT=./storage/instances-from-dotenv',
      ].join('\n'),
    );
    await writeFile(fastagentBinaryPath, '#!/bin/sh\nexit 0\n');
    await chmod(fastagentBinaryPath, 0o755);

    const config = await loadConfigInIsolatedProcess(appDir, {
      FASTAGENT_API_KEY: 'test-fastagent-key',
      FASTAGENT_DEFAULT_MODEL: 'gpt-5.4',
      FASTAGENT_DEFAULT_PROVIDER: 'openai',
      FASTAGENT_SANDBOX_MODE: 'disabled',
    });

    expect(config).toMatchObject({
      databaseUrl: 'file:./storage/sqlite/optional.sqlite',
      instancesRoot: join(dir, 'storage', 'instances-from-dotenv'),
    });
  });

  it('does not auto-load the workspace .env when the caller provides an explicit env object', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-supervisor-config-explicit-env-'));
    tempDirs.push(dir);

    const appDir = join(dir, 'apps', 'supervisor');
    await mkdir(appDir, { recursive: true });
    await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n  - packages/*\n');
    await writeFile(
      join(dir, '.env'),
      [
        'FASTAGENT_API_KEY=test-fastagent-key',
        'FASTAGENT_BINARY_PATH=/tmp/fastagent',
        'FASTAGENT_DEFAULT_MODEL=gpt-5.4',
        'FASTAGENT_DEFAULT_PROVIDER=openai',
        'SANDBOX_API_KEY=test-sandbox-key',
        'SANDBOX_URL=http://127.0.0.1:8788',
      ].join('\n'),
    );

    const config = getSupervisorConfig({
      FASTAGENT_BINARY_PATH: '/tmp/fastagent',
      FASTAGENT_SANDBOX_MODE: 'disabled',
    }, appDir);

    expect(config).toMatchObject({
      databaseUrl: 'file:./storage/sqlite/db.sqlite',
      fastagentBinaryPath: '/tmp/fastagent',
    });
    expect(config).not.toHaveProperty('fastagentApiKey');
    expect(config).not.toHaveProperty('fastagentApiType');
    expect(config).not.toHaveProperty('fastagentBaseUrl');
    expect(config).not.toHaveProperty('fastagentDefaultModel');
    expect(config).not.toHaveProperty('fastagentDefaultProvider');
  });

  it('prefers WEILING runtime variables and falls back to their legacy names', () => {
    const legacyConfig = getSupervisorConfig({
      FASTAGENT_BINARY_PATH: '/tmp/fastagent',
      FASTAGENT_SANDBOX_MODE: 'disabled',
      WECLAWS_INTERNAL_API_TOKEN: 'legacy-token',
      WECLAWS_INTERNAL_PORT: '8811',
      WECLAWS_LARK_CLI_PATH: 'legacy-lark',
      WECLAWS_LARK_CONFIG_ROOT: '/tmp/legacy-lark-config',
    }, process.cwd());

    expect(legacyConfig).toMatchObject({
      internalApiToken: 'legacy-token',
      internalPort: 8811,
      larkCliPath: 'legacy-lark',
      larkConfigRoot: '/tmp/legacy-lark-config',
    });

    const preferredConfig = getSupervisorConfig({
      FASTAGENT_BINARY_PATH: '/tmp/fastagent',
      FASTAGENT_SANDBOX_MODE: 'disabled',
      WEILING_INTERNAL_API_TOKEN: 'preferred-token',
      WEILING_INTERNAL_PORT: '8822',
      WEILING_LARK_CLI_PATH: 'preferred-lark',
      WEILING_LARK_CONFIG_ROOT: '/tmp/preferred-lark-config',
      WECLAWS_INTERNAL_API_TOKEN: 'legacy-token',
      WECLAWS_INTERNAL_PORT: '8811',
      WECLAWS_LARK_CLI_PATH: 'legacy-lark',
      WECLAWS_LARK_CONFIG_ROOT: '/tmp/legacy-lark-config',
    }, process.cwd());

    expect(preferredConfig).toMatchObject({
      internalApiToken: 'preferred-token',
      internalPort: 8822,
      larkCliPath: 'preferred-lark',
      larkConfigRoot: '/tmp/preferred-lark-config',
    });
  });

  it('allows disabled sandbox mode without requiring sandbox env variables', () => {
    const config = getSupervisorConfig({
      FASTAGENT_BINARY_PATH: '/tmp/fastagent',
      FASTAGENT_SANDBOX_MODE: 'disabled',
    }, process.cwd());

    expect(config).toMatchObject({
      fastagentBinaryPath: '/tmp/fastagent',
      sandboxApiKey: null,
      sandboxMode: 'disabled',
      sandboxUrl: null,
      srtPoolConfigFile: null,
      srtPoolStatusFile: null,
      srtServiceHost: null,
      srtWorkspaceMapDir: null,
    });
    expect(config).not.toHaveProperty('fastagentApiKey');
    expect(config).not.toHaveProperty('fastagentApiType');
    expect(config).not.toHaveProperty('fastagentBaseUrl');
    expect(config).not.toHaveProperty('fastagentDefaultModel');
    expect(config).not.toHaveProperty('fastagentDefaultProvider');
  });

  it('allows supervisor startup without global fastagent runtime defaults when Bots use scoped config', () => {
    const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url));
    const config = getSupervisorConfig({
      FASTAGENT_BINARY_PATH: '/tmp/fastagent',
      FASTAGENT_SANDBOX_MODE: 'remote',
    }, process.cwd());

    expect(config).toMatchObject({
      fastagentBinaryPath: '/tmp/fastagent',
      sandboxApiKey: null,
      sandboxMode: 'remote',
      sandboxUrl: null,
      srtPoolConfigFile: join(workspaceRoot, 'storage', 'sandbox-runtime-private', 'srt-pools.json'),
      srtPoolStatusFile: join(workspaceRoot, 'storage', 'sandbox-runtime-private', 'srt-pool-status.json'),
      srtServiceHost: 'sandbox-runtime',
      srtWorkspaceMapDir: join(workspaceRoot, 'storage', 'sandbox-runtime-private', 'workspace-map'),
    });
    expect(config.srtPoolDefaults).toMatchObject({
      minReadyProcesses: 1,
      poolSize: 1,
    });
    expect(config).not.toHaveProperty('fastagentApiKey');
    expect(config).not.toHaveProperty('fastagentApiType');
    expect(config).not.toHaveProperty('fastagentBaseUrl');
    expect(config).not.toHaveProperty('fastagentDefaultModel');
    expect(config).not.toHaveProperty('fastagentDefaultProvider');
  });

  it('rejects unsupported sandbox modes', () => {
    expect(() => getSupervisorConfig({
      FASTAGENT_BINARY_PATH: '/tmp/fastagent',
      FASTAGENT_SANDBOX_MODE: 'local',
    }, process.cwd())).toThrow(
      'FASTAGENT_SANDBOX_MODE must be one of: remote, disabled.',
    );
  });
});

async function loadConfigInIsolatedProcess(appDir: string, env: Record<string, string> = {}) {
  const moduleUrl = new URL('../config.ts', import.meta.url).href;
  const tsxImportUrl = new URL('../../node_modules/tsx/dist/esm/index.mjs', import.meta.url).href;
  const script = [
    `import { getSupervisorConfig } from ${JSON.stringify(moduleUrl)};`,
    `const config = getSupervisorConfig(process.env, ${JSON.stringify(appDir)});`,
    'console.log(JSON.stringify(config));',
  ].join('\n');
  const { stdout } = await execFile(
    process.execPath,
    ['--input-type=module', '--import', tsxImportUrl, '--eval', script],
    {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        ...env,
      },
    },
  );

  return JSON.parse(stdout) as ReturnType<typeof getSupervisorConfig>;
}
