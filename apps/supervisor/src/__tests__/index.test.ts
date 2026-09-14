import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  runGlobalAgentConfigPass,
  runMorningBriefingPass,
  runMorningBriefingPolicyPass,
  runSupervisorProcess,
  scheduleReconcilePass,
} from '../index';

const tempDirs: string[] = [];
const execFile = promisify(execFileCallback);

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('startSupervisor', () => {
  it('rejects a second startup in the same workspace until the first runtime closes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-supervisor-start-'));
    tempDirs.push(dir);

    const appDir = join(dir, 'apps', 'supervisor');
    const bundleDir = join(dir, 'resources', 'skills', 'managed');
    await mkdir(appDir, { recursive: true });
    await mkdir(bundleDir, { recursive: true });
    await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n  - packages/*\n');
    await writeFile(join(bundleDir, 'manifest.json'), JSON.stringify({
      skills: [],
      version: 'bundle-v0',
    }, null, 2));

    const moduleUrl = new URL('../index.ts', import.meta.url).href;
    const tsxImportUrl = new URL('../../node_modules/tsx/dist/esm/index.mjs', import.meta.url).href;
    const tsxTsconfigPath = fileURLToPath(new URL('../../tsconfig.json', import.meta.url));
    const script = [
      `import { startSupervisor } from ${JSON.stringify(moduleUrl)};`,
      `process.chdir(${JSON.stringify(appDir)});`,
      'const first = await startSupervisor();',
      'let secondError = null;',
      'try {',
      '  await startSupervisor();',
      '} catch (error) {',
      '  secondError = error instanceof Error ? error.message : String(error);',
      '}',
      'await first.close();',
      'const third = await startSupervisor();',
      'await third.close();',
      'console.log(JSON.stringify({ secondError }));',
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
          TSX_TSCONFIG_PATH: tsxTsconfigPath,
          DATABASE_URL: 'file:./storage/sqlite/test.sqlite',
          FASTAGENT_BINARY_PATH: '/tmp/fastagent',
          FASTAGENT_SANDBOX_MODE: 'disabled',
        },
      },
    );

    const result = JSON.parse(stdout) as { secondError: string | null };

    expect(result.secondError).toContain('Supervisor singleton lock is already held by pid');
  }, 15_000);
});

describe('runSupervisorProcess', () => {
  it('waits for an in-flight startup to resolve before closing on SIGTERM', async () => {
    const signalHandlers = new Map<'SIGINT' | 'SIGTERM', () => void>();
    const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const exit = vi.fn<(code: number) => void>();
    const logError = vi.fn<(error: unknown) => void>();
    let resolveStartup!: (runtime: { close(): Promise<void> }) => void;

    runSupervisorProcess({
      exit,
      logError,
      registerSignal: (signal, handler) => {
        signalHandlers.set(signal, handler);
      },
      start: () => new Promise((resolve) => {
        resolveStartup = resolve;
      }),
    });

    signalHandlers.get('SIGTERM')?.();
    await flushMicrotasks();

    expect(close).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();

    resolveStartup({ close });
    await vi.waitFor(() => {
      expect(close).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(0);
    });
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(exit.mock.invocationCallOrder[0]);
    expect(logError).not.toHaveBeenCalled();
  });
});

describe('scheduleReconcilePass', () => {
  it('catches rejected reconcile passes and forwards them to the provided error handler', async () => {
    const onError = vi.fn<(error: unknown) => void>();
    const failure = new Error('spawn failed');

    scheduleReconcilePass({
      runOnce: vi.fn().mockRejectedValue(failure),
    }, onError);

    await flushMicrotasks();

    expect(onError).toHaveBeenCalledWith(failure);
  });
});

describe('runMorningBriefingPolicyPass', () => {
  it('reports a policy-list failure without rejecting the supervisor reconcile cycle', async () => {
    const onError = vi.fn<(error: unknown) => void>();
    const failure = new Error('policy query failed');

    await expect(runMorningBriefingPolicyPass({
      runOnce: vi.fn().mockRejectedValue(failure),
    }, onError)).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledWith(failure);
  });
});

describe('runMorningBriefingPass', () => {
  it('reports a scheduler failure without rejecting the supervisor reconcile cycle', async () => {
    const onError = vi.fn<(error: unknown) => void>();
    const failure = new Error('central delivery query failed');

    await expect(runMorningBriefingPass({
      runOnce: vi.fn().mockRejectedValue(failure),
    }, onError)).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledWith(failure);
  });
});

describe('runGlobalAgentConfigPass', () => {
  it('reports a global publication failure without rejecting the supervisor reconcile cycle', async () => {
    const onError = vi.fn<(error: unknown) => void>();
    const failure = new Error('global config query failed');

    await expect(runGlobalAgentConfigPass({
      runOnce: vi.fn().mockRejectedValue(failure),
    }, onError)).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledWith(failure);
  });
});

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}
