import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('getEnv', () => {
  it('loads required web env from the workspace root .env file in local development', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-web-env-'));
    tempDirs.push(dir);

    const appDir = join(dir, 'apps', 'web');
    const dbFile = join(dir, 'storage', 'sqlite', 'db.sqlite');
    await mkdir(appDir, { recursive: true });
    await mkdir(join(dir, 'storage', 'sqlite'), { recursive: true });
    await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n  - packages/*\n');
    await writeFile(dbFile, '');
    await writeFile(
      join(dir, '.env'),
      [
        `DATABASE_URL=file:${dbFile}`,
        'APP_BASE_URL=http://localhost:3000',
        'BETTER_AUTH_SECRET=test-secret',
      ].join('\n'),
    );

    const env = await loadEnvInIsolatedProcess(appDir);

    expect(env).toMatchObject({
      DATABASE_URL: `file:${dbFile}`,
      APP_BASE_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: 'test-secret',
      WEB_USER_BOT_LIMIT: 0,
      WEB_ADMIN_EMAILS: '',
      srtPoolDefaults: expect.objectContaining({
        poolSize: 1,
        minReadyProcesses: 1,
        portBase: 31_000,
        proxyPortBase: 9_100,
      }),
    });
  });

  it('keeps explicit process env values without requiring a workspace .env file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-web-env-explicit-'));
    tempDirs.push(dir);

    const appDir = join(dir, 'apps', 'web');
    const dbFile = join(dir, 'storage', 'sqlite', 'db.sqlite');
    await mkdir(appDir, { recursive: true });
    await mkdir(join(dir, 'storage', 'sqlite'), { recursive: true });
    await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n  - packages/*\n');
    await writeFile(dbFile, '');

    const env = await loadEnvInIsolatedProcess(appDir, {
      DATABASE_URL: `file:${dbFile}`,
      APP_BASE_URL: 'http://localhost:3001',
      BETTER_AUTH_SECRET: 'explicit-secret',
      WEB_ADMIN_EMAILS: 'admin@example.com',
      WEB_USER_BOT_LIMIT: '3',
      SRT_DEFAULT_POOL_SIZE: '4',
      SRT_DEFAULT_MIN_READY_PROCESSES: '2',
      SRT_PORT_BASE: '33000',
      SRT_PROXY_PORT_BASE: '9300',
    });

    expect(env).toMatchObject({
      DATABASE_URL: `file:${dbFile}`,
      APP_BASE_URL: 'http://localhost:3001',
      BETTER_AUTH_SECRET: 'explicit-secret',
      WEB_USER_BOT_LIMIT: 3,
      WEB_ADMIN_EMAILS: 'admin@example.com',
      srtPoolDefaults: expect.objectContaining({
        poolSize: 4,
        minReadyProcesses: 2,
        portBase: 33_000,
        proxyPortBase: 9_300,
      }),
    });
  });

  it('loads WEB_USER_BOT_LIMIT from the workspace root .env when required web env comes from process.env', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-web-env-mixed-sources-'));
    tempDirs.push(dir);

    const appDir = join(dir, 'apps', 'web');
    const dbFile = join(dir, 'storage', 'sqlite', 'db.sqlite');
    await mkdir(appDir, { recursive: true });
    await mkdir(join(dir, 'storage', 'sqlite'), { recursive: true });
    await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n  - packages/*\n');
    await writeFile(dbFile, '');
    await writeFile(
      join(dir, '.env'),
      [
        'WEB_USER_BOT_LIMIT=5',
      ].join('\n'),
    );

    const env = await loadEnvInIsolatedProcess(appDir, {
      DATABASE_URL: `file:${dbFile}`,
      APP_BASE_URL: 'http://localhost:3001',
      BETTER_AUTH_SECRET: 'explicit-secret',
    });

    expect(env).toMatchObject({
      DATABASE_URL: `file:${dbFile}`,
      APP_BASE_URL: 'http://localhost:3001',
      BETTER_AUTH_SECRET: 'explicit-secret',
      WEB_USER_BOT_LIMIT: 5,
      WEB_ADMIN_EMAILS: '',
    });
  });

  it('loads SRT pool defaults from the workspace root .env when web env comes from process.env', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-web-env-srt-defaults-'));
    tempDirs.push(dir);

    const appDir = join(dir, 'apps', 'web');
    const dbFile = join(dir, 'storage', 'sqlite', 'db.sqlite');
    await mkdir(appDir, { recursive: true });
    await mkdir(join(dir, 'storage', 'sqlite'), { recursive: true });
    await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n  - packages/*\n');
    await writeFile(dbFile, '');
    await writeFile(
      join(dir, '.env'),
      [
        'SRT_DEFAULT_POOL_SIZE=5',
        'SRT_DEFAULT_MIN_READY_PROCESSES=2',
        'SRT_DEFAULT_MAX_CONCURRENT_INIT=2',
        'SRT_PORT_BASE=34000',
        'SRT_PROXY_PORT_BASE=9400',
        'SRT_WORKSPACE_BASE_ROOT=/srv/weiling/srt-workspaces',
      ].join('\n'),
    );

    const env = await loadEnvInIsolatedProcess(appDir, {
      DATABASE_URL: `file:${dbFile}`,
      APP_BASE_URL: 'http://localhost:3001',
      BETTER_AUTH_SECRET: 'explicit-secret',
      WEB_ADMIN_EMAILS: 'admin@example.com',
      WEB_USER_BOT_LIMIT: '7',
    });

    expect(env.srtPoolDefaults).toMatchObject({
      maxConcurrentInit: 2,
      minReadyProcesses: 2,
      poolSize: 5,
      portBase: 34_000,
      proxyPortBase: 9_400,
      workspaceBaseRoot: '/srv/weiling/srt-workspaces',
    });
  });
});

describe('env module exports', () => {
  it('is no longer exported now that create-bot runtime comes from llm profiles only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-create-bot-runtime-config-'));
    tempDirs.push(dir);

    const appDir = join(dir, 'apps', 'web');
    await mkdir(appDir, { recursive: true });
    await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n  - packages/*\n');

    const exportedNames = await loadEnvModuleExportNamesInIsolatedProcess(appDir);

    expect(exportedNames).not.toContain('getCreateBotRuntimeConfig');
    expect(exportedNames).not.toContain('getDefaultLlmConfig');
  });
});

describe('resolveInstancesRoot', () => {
  it('loads INSTANCES_ROOT from the workspace root .env file in local development', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-web-instances-root-'));
    tempDirs.push(dir);

    const appDir = join(dir, 'apps', 'web');
    await mkdir(appDir, { recursive: true });
    await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n  - packages/*\n');
    await writeFile(
      join(dir, '.env'),
      [
        'DATABASE_URL=file:./storage/sqlite/db.sqlite',
        'APP_BASE_URL=http://localhost:3000',
        'BETTER_AUTH_SECRET=test-secret',
        'INSTANCES_ROOT=./storage/custom-instances',
      ].join('\n'),
    );

    const instancesRoot = await loadInstancesRootInIsolatedProcess(appDir);

    const workspaceRoot = await realpath(dir);
    expect(instancesRoot).toBe(join(workspaceRoot, 'storage', 'custom-instances'));
  });

  it('keeps an explicit INSTANCES_ROOT env override without requiring a workspace .env file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-web-instances-root-explicit-'));
    tempDirs.push(dir);

    const appDir = join(dir, 'apps', 'web');
    await mkdir(appDir, { recursive: true });
    await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n  - packages/*\n');

    const instancesRoot = await loadInstancesRootInIsolatedProcess(appDir, {
      INSTANCES_ROOT: './storage/instances-explicit',
    });

    const workspaceRoot = await realpath(dir);
    expect(instancesRoot).toBe(join(workspaceRoot, 'storage', 'instances-explicit'));
  });
});

describe('resolveSrtPoolStatusFile', () => {
  it('defaults to the workspace sandbox-runtime-private status path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-web-srt-status-default-'));
    tempDirs.push(dir);

    const appDir = join(dir, 'apps', 'web');
    await mkdir(appDir, { recursive: true });
    await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n  - packages/*\n');

    const statusFile = await loadSrtPoolStatusFileInIsolatedProcess(appDir);

    const workspaceRoot = await realpath(dir);
    expect(statusFile).toBe(join(workspaceRoot, 'storage', 'sandbox-runtime-private', 'srt-pool-status.json'));
  });

  it('resolves an explicit relative SRT_POOL_STATUS_FILE from the workspace root .env', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-web-srt-status-env-'));
    tempDirs.push(dir);

    const appDir = join(dir, 'apps', 'web');
    await mkdir(appDir, { recursive: true });
    await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n  - packages/*\n');
    await writeFile(join(dir, '.env'), 'SRT_POOL_STATUS_FILE=./storage/private/custom-status.json\n');

    const statusFile = await loadSrtPoolStatusFileInIsolatedProcess(appDir);

    const workspaceRoot = await realpath(dir);
    expect(statusFile).toBe(join(workspaceRoot, 'storage', 'private', 'custom-status.json'));
  });
});

async function loadEnvInIsolatedProcess(
  appDir: string,
  env: Record<string, string> = {},
) {
  const moduleUrl = new URL('../env.ts', import.meta.url).href;
  const tsxImportUrl = new URL(
    '../../../../../apps/supervisor/node_modules/tsx/dist/esm/index.mjs',
    import.meta.url,
  ).href;
  const script = [
    `import { getEnv } from ${JSON.stringify(moduleUrl)};`,
    `process.chdir(${JSON.stringify(appDir)});`,
    'console.log(JSON.stringify(getEnv()));',
  ].join('\n');
  const { stdout } = await execFile(
    process.execPath,
    ['--input-type=module', '--import', tsxImportUrl, '--eval', script],
    {
      cwd: process.cwd(),
      env: env as NodeJS.ProcessEnv,
    },
  );

  return JSON.parse(stdout) as {
    APP_BASE_URL: string;
    BETTER_AUTH_SECRET: string;
    DATABASE_URL: string;
    WEB_ADMIN_EMAILS: string;
    WEB_USER_BOT_LIMIT: number;
    srtPoolDefaults: {
      maxConcurrentInit: number;
      minReadyProcesses: number;
      poolSize: number;
      portBase: number;
      proxyPortBase: number;
      workspaceBaseRoot: string;
    };
  };
}

async function loadEnvModuleExportNamesInIsolatedProcess(
  appDir: string,
  env: Record<string, string> = {},
) {
  const moduleUrl = new URL('../env.ts', import.meta.url).href;
  const tsxImportUrl = new URL(
    '../../../../../apps/supervisor/node_modules/tsx/dist/esm/index.mjs',
    import.meta.url,
  ).href;
  const script = [
    `const envModule = await import(${JSON.stringify(moduleUrl)});`,
    `process.chdir(${JSON.stringify(appDir)});`,
    'console.log(JSON.stringify(Object.keys(envModule).sort()));',
  ].join('\n');
  const { stdout } = await execFile(
    process.execPath,
    ['--input-type=module', '--import', tsxImportUrl, '--eval', script],
    {
      cwd: process.cwd(),
      env: env as NodeJS.ProcessEnv,
    },
  );

  return JSON.parse(stdout) as string[];
}

async function loadInstancesRootInIsolatedProcess(
  appDir: string,
  env: Record<string, string> = {},
) {
  const moduleUrl = new URL('../env.ts', import.meta.url).href;
  const tsxImportUrl = new URL(
    '../../../../../apps/supervisor/node_modules/tsx/dist/esm/index.mjs',
    import.meta.url,
  ).href;
  const script = [
    `import { resolveInstancesRoot } from ${JSON.stringify(moduleUrl)};`,
    `process.chdir(${JSON.stringify(appDir)});`,
    'console.log(JSON.stringify(resolveInstancesRoot()));',
  ].join('\n');
  const { stdout } = await execFile(
    process.execPath,
    ['--input-type=module', '--import', tsxImportUrl, '--eval', script],
    {
      cwd: process.cwd(),
      env: env as NodeJS.ProcessEnv,
    },
  );

  return JSON.parse(stdout) as string;
}

async function loadSrtPoolStatusFileInIsolatedProcess(
  appDir: string,
  env: Record<string, string> = {},
) {
  const moduleUrl = new URL('../env.ts', import.meta.url).href;
  const tsxImportUrl = new URL(
    '../../../../../apps/supervisor/node_modules/tsx/dist/esm/index.mjs',
    import.meta.url,
  ).href;
  const script = [
    `import { resolveSrtPoolStatusFile } from ${JSON.stringify(moduleUrl)};`,
    `process.chdir(${JSON.stringify(appDir)});`,
    'console.log(JSON.stringify(resolveSrtPoolStatusFile()));',
  ].join('\n');
  const { stdout } = await execFile(
    process.execPath,
    ['--input-type=module', '--import', tsxImportUrl, '--eval', script],
    {
      cwd: process.cwd(),
      env: env as NodeJS.ProcessEnv,
    },
  );

  return JSON.parse(stdout) as string;
}
