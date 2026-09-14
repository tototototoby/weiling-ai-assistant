import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSandboxRuntimePoolDefaults } from '@weiling-ai/shared';
import type { SupervisorConfig } from '../../config';
import { createFastAgentWorkspaceId } from '../sandbox-workspace-map';
import {
  createFastAgentSpawnSpec,
  spawnFastAgentProcess,
  type ResolvedSandboxRuntimePool,
  type SpawnableBotInstance,
} from '../spawn-fastagent';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('createFastAgentSpawnSpec', () => {
  it('builds the documented real FastAgent command and derives runtime paths from instances root', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-spawn-spec-'));
    tempDirs.push(dir);

    const fastagentBinaryPath = join(dir, 'fastagent');
    await writeFile(fastagentBinaryPath, '#!/bin/sh\nexit 0\n');
    await chmod(fastagentBinaryPath, 0o755);

    const botInstance = createBotInstanceFixture(dir, fastagentBinaryPath);
    const config = createConfigFixture(dir, fastagentBinaryPath);

    const spec = await createFastAgentSpawnSpec({
      botInstance,
      config,
      runtimeConfig: createRuntimeConfigFixture(),
      sandboxRuntimePool: createSandboxRuntimePoolFixture(dir),
    });

    expect(spec.command).toBe(fastagentBinaryPath);
    expect(spec.args).toEqual([
      '--channel',
      'weixin',
      '--sandbox',
      'remote',
      '--sandbox-url',
      'http://sandbox-runtime:31000',
      '--output',
      'jsonl',
    ]);
    expect(spec.cwd).toBe(join(dir, 'bot_1', 'workspace'));
    expect(spec.env).toMatchObject({
      FASTAGENT_API_KEY: 'test-fastagent-key',
      FASTAGENT_MODEL: 'claude-opus-4-6',
      FASTAGENT_PROVIDER: 'anthropic',
      IM_GATEWAY_AGENT_ID: 'bot_1',
      IM_GATEWAY_ALLOW_ALL_PERMISSIONS: 'true',
      IM_GATEWAY_DATA_DIR: join(dir, 'bot_1', 'data'),
      IM_GATEWAY_WORKSPACE_DIR: join(dir, 'bot_1', 'workspace'),
      SANDBOX_API_KEY: 'pool-key',
      SANDBOX_URL: 'http://sandbox-runtime:31000',
      WECLAWS_BOT_INSTANCE_ID: 'bot_1',
      WECLAWS_DATABASE_URL: `file:${join(dir, 'test.sqlite')}`,
      WECLAWS_INTERNAL_API_TOKEN: '',
      WECLAWS_INTERNAL_URL: 'http://127.0.0.1:8790',
    });
    expect(spec.env.WECLAWS_OPENCODE_SESSION_ID).toBeUndefined();
  });

  it('omits sandbox args and env when sandbox mode is disabled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-spawn-spec-disabled-'));
    tempDirs.push(dir);

    const fastagentBinaryPath = join(dir, 'fastagent');
    await writeFile(fastagentBinaryPath, '#!/bin/sh\nexit 0\n');
    await chmod(fastagentBinaryPath, 0o755);

    const botInstance = createBotInstanceFixture(dir, fastagentBinaryPath);
    const config = createConfigFixture(dir, fastagentBinaryPath, {
      sandboxApiKey: null,
      sandboxMode: 'disabled',
      sandboxUrl: null,
    });

    const spec = await createFastAgentSpawnSpec({
      botInstance,
      config,
      runtimeConfig: createRuntimeConfigFixture(),
    });

    expect(spec.args).toEqual([
      '--channel',
      'weixin',
      '--output',
      'jsonl',
    ]);
    expect(spec.env.SANDBOX_API_KEY).toBeUndefined();
    expect(spec.env.SANDBOX_URL).toBeUndefined();
  });

  it('registers the real bot workspace in the sandbox workspace map before remote sandbox turns run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-spawn-spec-workspace-map-'));
    tempDirs.push(dir);

    const fastagentBinaryPath = join(dir, 'fastagent');
    await writeFile(fastagentBinaryPath, '#!/bin/sh\nexit 0\n');
    await chmod(fastagentBinaryPath, 0o755);

    const sandboxWorkspaceMapFile = join(dir, '.sandbox-runtime', 'workspace-map', 'user_1.json');
    const botInstance = createBotInstanceFixture(dir, fastagentBinaryPath);
    const config = createConfigFixture(dir, fastagentBinaryPath);

    await createFastAgentSpawnSpec({
      botInstance,
      config,
      runtimeConfig: createRuntimeConfigFixture(),
      sandboxRuntimePool: createSandboxRuntimePoolFixture(dir, {
        workspaceMapFile: sandboxWorkspaceMapFile,
      }),
    });

    const workspaceId = await createFastAgentWorkspaceId(join(dir, 'bot_1', 'workspace'));
    const workspaceMap = JSON.parse(await readFile(sandboxWorkspaceMapFile, 'utf8')) as {
      workspaces: Record<string, { workspacePath: string }>;
    };

    expect(workspaceMap.workspaces[workspaceId]).toMatchObject({
      workspacePath: await realpath(join(dir, 'bot_1', 'workspace')),
    });
  });

  it('removes inherited sandbox env when sandbox mode is disabled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-spawn-spec-inherited-disabled-'));
    tempDirs.push(dir);

    const previousSandboxApiKey = process.env.SANDBOX_API_KEY;
    const previousSandboxUrl = process.env.SANDBOX_URL;
    process.env.SANDBOX_API_KEY = 'inherited-sandbox-key';
    process.env.SANDBOX_URL = 'http://inherited-sandbox:8788';

    try {
      const fastagentBinaryPath = join(dir, 'fastagent');
      await writeFile(fastagentBinaryPath, '#!/bin/sh\nexit 0\n');
      await chmod(fastagentBinaryPath, 0o755);

      const botInstance = createBotInstanceFixture(dir, fastagentBinaryPath);
      const config = createConfigFixture(dir, fastagentBinaryPath, {
        sandboxApiKey: null,
        sandboxMode: 'disabled',
        sandboxUrl: null,
      });

      const spec = await createFastAgentSpawnSpec({
        botInstance,
        config,
        runtimeConfig: createRuntimeConfigFixture(),
        sandboxRuntimePool: createSandboxRuntimePoolFixture(dir),
      });

      expect(spec.env.SANDBOX_API_KEY).toBeUndefined();
      expect(spec.env.SANDBOX_URL).toBeUndefined();
    } finally {
      restoreEnvVar('SANDBOX_API_KEY', previousSandboxApiKey);
      restoreEnvVar('SANDBOX_URL', previousSandboxUrl);
    }
  });

  it('does not leak control-plane secrets or global llm defaults into child env', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-spawn-spec-sanitized-env-'));
    tempDirs.push(dir);

    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousBetterAuthSecret = process.env.BETTER_AUTH_SECRET;
    const previousWebAdminEmails = process.env.WEB_ADMIN_EMAILS;
    const previousFastAgentBaseUrl = process.env.FASTAGENT_BASE_URL;
    const previousFastAgentApiType = process.env.FASTAGENT_API_TYPE;
    const previousHttpsProxy = process.env.HTTPS_PROXY;

    process.env.DATABASE_URL = 'file:/tmp/leaked.sqlite';
    process.env.BETTER_AUTH_SECRET = 'should-not-reach-fastagent';
    process.env.WEB_ADMIN_EMAILS = 'admin@example.com';
    process.env.FASTAGENT_BASE_URL = 'https://gateway.example.com/v1';
    process.env.FASTAGENT_API_TYPE = 'openai-responses';
    process.env.HTTPS_PROXY = 'http://proxy.internal.example:8080';

    try {
      const fastagentBinaryPath = join(dir, 'fastagent');
      await writeFile(fastagentBinaryPath, '#!/bin/sh\nexit 0\n');
      await chmod(fastagentBinaryPath, 0o755);

      const botInstance = createBotInstanceFixture(dir, fastagentBinaryPath);
      const config = createConfigFixture(dir, fastagentBinaryPath);

      const spec = await createFastAgentSpawnSpec({
        botInstance,
        config,
        runtimeConfig: createRuntimeConfigFixture(),
        sandboxRuntimePool: createSandboxRuntimePoolFixture(dir),
      });

      expect(spec.env).toMatchObject({
        HTTPS_PROXY: 'http://proxy.internal.example:8080',
      });
      expect(spec.env.DATABASE_URL).toBeUndefined();
      expect(spec.env.BETTER_AUTH_SECRET).toBeUndefined();
      expect(spec.env.WEB_ADMIN_EMAILS).toBeUndefined();
      expect(spec.env.FASTAGENT_BASE_URL).toBeUndefined();
      expect(spec.env.FASTAGENT_API_TYPE).toBeUndefined();
    } finally {
      restoreEnvVar('DATABASE_URL', previousDatabaseUrl);
      restoreEnvVar('BETTER_AUTH_SECRET', previousBetterAuthSecret);
      restoreEnvVar('WEB_ADMIN_EMAILS', previousWebAdminEmails);
      restoreEnvVar('FASTAGENT_BASE_URL', previousFastAgentBaseUrl);
      restoreEnvVar('FASTAGENT_API_TYPE', previousFastAgentApiType);
      restoreEnvVar('HTTPS_PROXY', previousHttpsProxy);
    }
  });

  it('injects only enabled knowledge runtime configs supplied by the supervisor', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-spawn-spec-dify-'));
    tempDirs.push(dir);
    const fastagentBinaryPath = join(dir, 'fastagent');
    await writeFile(fastagentBinaryPath, '#!/bin/sh\nexit 0\n');
    await chmod(fastagentBinaryPath, 0o755);

    const spec = await createFastAgentSpawnSpec({
      botInstance: createBotInstanceFixture(dir, fastagentBinaryPath),
      config: createConfigFixture(dir, fastagentBinaryPath),
      difyConfig: {
        apiBaseUrl: 'http://dify.internal/v1',
        apiKey: 'app-secret',
        appName: '公司知识库',
        revision: 7,
      },
      ragflowConfig: {
        apiBaseUrl: 'http://ragflow.internal',
        apiKey: 'ragflow-secret',
        datasetIds: ['dataset_1', 'dataset_2'],
        knowledgeBaseName: 'RAGFlow 公司知识库',
        revision: 3,
      },
      runtimeConfig: createRuntimeConfigFixture(),
      sandboxRuntimePool: createSandboxRuntimePoolFixture(dir),
    });

    expect(spec.env).toMatchObject({
      DIFY_API_BASE_URL: 'http://dify.internal/v1',
      DIFY_API_KEY: 'app-secret',
      DIFY_APP_NAME: '公司知识库',
      DIFY_CONFIG_REVISION: '7',
      RAGFLOW_API_BASE_URL: 'http://ragflow.internal',
      RAGFLOW_API_KEY: 'ragflow-secret',
      RAGFLOW_CONFIG_REVISION: '3',
      RAGFLOW_DATASET_IDS_JSON: '["dataset_1","dataset_2"]',
      RAGFLOW_KNOWLEDGE_BASE_NAME: 'RAGFlow 公司知识库',
    });
  });

  it('preserves lowercase proxy env vars that are commonly used in container and CI environments', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-spawn-spec-lowercase-proxy-'));
    tempDirs.push(dir);

    const previousHttpProxy = process.env.http_proxy;
    const previousHttpsProxy = process.env.https_proxy;
    const previousNoProxy = process.env.no_proxy;

    process.env.http_proxy = 'http://proxy.internal.example:8080';
    process.env.https_proxy = 'http://proxy.internal.example:8443';
    process.env.no_proxy = 'localhost,127.0.0.1';

    try {
      const fastagentBinaryPath = join(dir, 'fastagent');
      await writeFile(fastagentBinaryPath, '#!/bin/sh\nexit 0\n');
      await chmod(fastagentBinaryPath, 0o755);

      const botInstance = createBotInstanceFixture(dir, fastagentBinaryPath);
      const config = createConfigFixture(dir, fastagentBinaryPath);

      const spec = await createFastAgentSpawnSpec({
        botInstance,
        config,
        runtimeConfig: createRuntimeConfigFixture(),
        sandboxRuntimePool: createSandboxRuntimePoolFixture(dir),
      });

      expect(spec.env).toMatchObject({
        http_proxy: 'http://proxy.internal.example:8080',
        https_proxy: 'http://proxy.internal.example:8443',
        no_proxy: 'localhost,127.0.0.1',
      });
    } finally {
      restoreEnvVar('http_proxy', previousHttpProxy);
      restoreEnvVar('https_proxy', previousHttpsProxy);
      restoreEnvVar('no_proxy', previousNoProxy);
    }
  });

  it('throws when the configured real FastAgent binary does not exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-spawn-missing-'));
    tempDirs.push(dir);

    const fastagentBinaryPath = join(dir, 'missing-fastagent');

    await expect(createFastAgentSpawnSpec({
      botInstance: createBotInstanceFixture(dir, fastagentBinaryPath),
      config: createConfigFixture(dir, fastagentBinaryPath),
      runtimeConfig: createRuntimeConfigFixture(),
      sandboxRuntimePool: createSandboxRuntimePoolFixture(dir),
    })).rejects.toThrow(`FastAgent binary not found: ${fastagentBinaryPath}`);
  });

  it.skipIf(process.platform === 'win32')(
    'throws when the configured real FastAgent binary is not executable',
    async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-spawn-not-executable-'));
    tempDirs.push(dir);

    const fastagentBinaryPath = join(dir, 'fastagent');
    await writeFile(fastagentBinaryPath, '#!/bin/sh\nexit 0\n');
    await chmod(fastagentBinaryPath, 0o644);

    await expect(createFastAgentSpawnSpec({
      botInstance: createBotInstanceFixture(dir, fastagentBinaryPath),
      config: createConfigFixture(dir, fastagentBinaryPath),
      runtimeConfig: createRuntimeConfigFixture(),
      sandboxRuntimePool: createSandboxRuntimePoolFixture(dir),
    })).rejects.toThrow(`FastAgent binary is not executable: ${fastagentBinaryPath}`);
    },
  );

  it('keeps the mock fixture path available for explicit test-only scenarios', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-spawn-mock-'));
    tempDirs.push(dir);

    const fastagentBinaryPath = join(dir, 'fastagent');
    await writeFile(fastagentBinaryPath, '#!/bin/sh\nexit 0\n');
    await chmod(fastagentBinaryPath, 0o755);

    const spec = await createFastAgentSpawnSpec({
      botInstance: createBotInstanceFixture(dir, fastagentBinaryPath),
      config: createConfigFixture(dir, fastagentBinaryPath),
      mockScenario: 'happy',
      runtimeConfig: createRuntimeConfigFixture(),
      sandboxRuntimePool: createSandboxRuntimePoolFixture(dir),
      stepDelayMs: 10,
    });

    expect(spec.command).toBe(process.execPath);
    expect(spec.args).toEqual([
      '--import',
      expect.stringContaining('tsx'),
      fileURLToPath(new URL('../../../../../tests/fixtures/mock-fastagent.ts', import.meta.url)),
    ]);
    expect(spec.env).toMatchObject({
      MOCK_FASTAGENT_SCENARIO: 'happy',
      MOCK_FASTAGENT_STEP_DELAY_MS: '10',
    });
  });

  it('injects one stable opencode-go session id per bot instance', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-spawn-opencode-session-'));
    tempDirs.push(dir);

    const fastagentBinaryPath = join(dir, 'fastagent');
    await writeFile(fastagentBinaryPath, '#!/bin/sh\nexit 0\n');
    await chmod(fastagentBinaryPath, 0o755);

    const openCodeRuntime = {
      ...createRuntimeConfigFixture(),
      apiType: 'openai-responses',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      model: 'deepseek-v4-flash',
      provider: 'opencode-go',
    };

    const first = await createFastAgentSpawnSpec({
      botInstance: createBotInstanceFixture(dir, fastagentBinaryPath),
      config: createConfigFixture(dir, fastagentBinaryPath),
      runtimeConfig: openCodeRuntime,
      sandboxRuntimePool: createSandboxRuntimePoolFixture(dir),
    });
    const second = await createFastAgentSpawnSpec({
      botInstance: createBotInstanceFixture(dir, fastagentBinaryPath),
      config: createConfigFixture(dir, fastagentBinaryPath),
      runtimeConfig: openCodeRuntime,
      sandboxRuntimePool: createSandboxRuntimePoolFixture(dir),
    });

    expect(first.env.WECLAWS_OPENCODE_SESSION_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(second.env.WECLAWS_OPENCODE_SESSION_ID).toBe(first.env.WECLAWS_OPENCODE_SESSION_ID);

    const otherBot = await createFastAgentSpawnSpec({
      botInstance: { ...createBotInstanceFixture(dir, fastagentBinaryPath), id: 'bot_2' },
      config: createConfigFixture(dir, fastagentBinaryPath),
      runtimeConfig: openCodeRuntime,
      sandboxRuntimePool: createSandboxRuntimePoolFixture(dir),
    });
    expect(otherBot.env.WECLAWS_OPENCODE_SESSION_ID).not.toBe(first.env.WECLAWS_OPENCODE_SESSION_ID);
  });
});

describe('spawnFastAgentProcess', () => {
  it('surfaces the same validation failure before spawning', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-spawn-process-'));
    tempDirs.push(dir);

    const fastagentBinaryPath = join(dir, 'missing-fastagent');

    await expect(spawnFastAgentProcess({
      botInstance: createBotInstanceFixture(dir, fastagentBinaryPath),
      config: createConfigFixture(dir, fastagentBinaryPath),
      runtimeConfig: createRuntimeConfigFixture(),
      sandboxRuntimePool: createSandboxRuntimePoolFixture(dir),
    })).rejects.toThrow(`FastAgent binary not found: ${fastagentBinaryPath}`);
  });
});

function createBotInstanceFixture(dir: string, fastagentBinaryPath: string): SpawnableBotInstance {
  void dir;
  void fastagentBinaryPath;
  return {
    id: 'bot_1',
    model: 'claude-opus-4-6',
    ownerUserId: 'user_1',
    provider: 'anthropic',
  };
}

function createConfigFixture(
  dir: string,
  fastagentBinaryPath: string,
  overrides: Partial<SupervisorConfig> = {},
): SupervisorConfig {
  return {
    databaseUrl: `file:${join(dir, 'test.sqlite')}`,
    fastagentBinaryPath,
    instancesRoot: dir,
    mockFastAgentFixturePath: fileURLToPath(
      new URL('../../../../../tests/fixtures/mock-fastagent.ts', import.meta.url),
    ),
    reconcileIntervalMs: 50,
    reconcileStallTimeoutMs: 120_000,
    sandboxMode: 'remote',
    sandboxApiKey: null,
    sandboxUrl: null,
    srtPoolConfigFile: join(dir, '.sandbox-runtime', 'srt-pools.json'),
    srtPoolDefaults: parseSandboxRuntimePoolDefaults({}),
    srtPoolStatusFile: join(dir, '.sandbox-runtime', 'srt-pool-status.json'),
    srtServiceHost: 'sandbox-runtime',
    srtWorkspaceMapDir: join(dir, '.sandbox-runtime', 'workspace-map'),
    workspaceRoot: dir,
    internalApiToken: overrides.internalApiToken ?? '',
    internalPort: overrides.internalPort ?? 8790,
    larkConfigRoot: overrides.larkConfigRoot ?? join(dir, 'lark'),
    larkCliPath: overrides.larkCliPath ?? 'lark-cli',
    ...overrides,
  };
}

function createSandboxRuntimePoolFixture(
  dir: string,
  overrides: Partial<ResolvedSandboxRuntimePool> = {},
): ResolvedSandboxRuntimePool {
  return {
    apiKey: 'pool-key',
    url: 'http://sandbox-runtime:31000',
    workspaceMapFile: join(dir, '.sandbox-runtime', 'workspace-map', 'user_1.json'),
    ...overrides,
  };
}

function createRuntimeConfigFixture() {
  return {
    apiKey: 'test-fastagent-key',
    apiType: null,
    baseUrl: null,
    model: 'claude-opus-4-6',
    provider: 'anthropic',
  };
}

function restoreEnvVar(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
