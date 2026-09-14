import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProcessStartedAt } from '../process-identity';
import { SupervisorSingletonLock } from '../supervisor-singleton-lock';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('SupervisorSingletonLock', () => {
  it('prevents a second lock acquisition while the first lock is still held', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-supervisor-lock-'));
    tempDirs.push(dir);

    const lockPath = join(dir, 'storage', 'supervisor.lock');
    const firstLock = new SupervisorSingletonLock(lockPath);
    const secondLock = new SupervisorSingletonLock(lockPath);

    await firstLock.acquire();

    await expect(secondLock.acquire()).rejects.toThrow(
      `Supervisor singleton lock is already held by pid ${process.pid}.`,
    );

    await firstLock.release();
    await expect(secondLock.acquire()).resolves.toBeUndefined();
    await secondLock.release();
  });

  it('replaces stale lock files whose owner pid is no longer alive', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-supervisor-stale-lock-'));
    tempDirs.push(dir);

    const lockPath = join(dir, 'storage', 'supervisor.lock');
    await mkdir(join(dir, 'storage'), { recursive: true });
    await writeFile(lockPath, JSON.stringify({
      pid: 999_999,
      startedAt: '2026-04-09T00:00:00.000Z',
      workspaceRoot: dir,
    }));

    const lock = new SupervisorSingletonLock(lockPath);

    await expect(lock.acquire()).resolves.toBeUndefined();
    await lock.release();
  });

  it('replaces a stale lock when a container reuses the current pid', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-supervisor-reused-pid-lock-'));
    tempDirs.push(dir);

    const lockPath = join(dir, 'storage', 'supervisor.lock');
    await mkdir(join(dir, 'storage'), { recursive: true });
    await writeFile(lockPath, JSON.stringify({
      pid: process.pid,
      startedAt: '2020-01-01T00:00:00.000Z',
      workspaceRoot: dir,
    }));

    const lock = new SupervisorSingletonLock(lockPath);

    await expect(lock.acquire()).resolves.toBeUndefined();
    await lock.release();
  });

  it('stops an existing supervisor-like process before acquiring the lock in a new process', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-supervisor-replace-lock-'));
    tempDirs.push(dir);

    const storageDir = join(dir, 'storage');
    const lockPath = join(storageDir, 'supervisor.lock');
    const supervisorEntrypoint = join(dir, 'src', 'index.js');

    await mkdir(storageDir, { recursive: true });
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(
      supervisorEntrypoint,
      [
        'process.on("SIGTERM", () => {',
        '  process.exit(0);',
        '});',
        'setInterval(() => {}, 1000);',
      ].join('\n'),
    );

    const child = spawn(process.execPath, [supervisorEntrypoint], {
      cwd: dir,
      stdio: 'ignore',
    });
    const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once('exit', (code, signal) => {
        resolve({ code, signal });
      });
    });

    await writeFile(lockPath, JSON.stringify({
      pid: child.pid,
      startedAt: await getProcessStartedAt(child.pid!),
      workspaceRoot: dir,
    }));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lock = new SupervisorSingletonLock(lockPath);

    await expect(lock.acquire()).resolves.toBeUndefined();
    const exitResult = await exitPromise;
    expect(wasTerminated(exitResult)).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`Existing supervisor pid ${child.pid} is still running`),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`Previous supervisor pid ${child.pid} stopped`),
    );

    warnSpy.mockRestore();
    await lock.release();
  }, 10_000);

  it('refuses to replace a live process when the lock startedAt does not match that pid birth time', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weixin-claws-supervisor-mismatched-lock-'));
    tempDirs.push(dir);

    const storageDir = join(dir, 'storage');
    const lockPath = join(storageDir, 'supervisor.lock');
    const supervisorEntrypoint = join(dir, 'src', 'index.js');

    await mkdir(storageDir, { recursive: true });
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(
      supervisorEntrypoint,
      [
        'process.on("SIGTERM", () => {',
        '  process.exit(0);',
        '});',
        'setInterval(() => {}, 1000);',
      ].join('\n'),
    );

    const child = spawn(process.execPath, [supervisorEntrypoint], {
      cwd: dir,
      stdio: 'ignore',
    });

    await writeFile(lockPath, JSON.stringify({
      pid: child.pid,
      startedAt: '2020-01-01T00:00:00.000Z',
      workspaceRoot: dir,
    }));

    const lock = new SupervisorSingletonLock(lockPath);

    await expect(lock.acquire()).rejects.toThrow(
      `Supervisor singleton lock is already held by pid ${child.pid}.`,
    );
    expect(child.exitCode).toBeNull();

    child.kill('SIGTERM');
    const exitResult = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once('exit', (code, signal) => {
        resolve({ code, signal });
      });
    });
    expect(wasTerminated(exitResult)).toBe(true);
  }, 10_000);
});

function wasTerminated(result: { code: number | null; signal: NodeJS.Signals | null }) {
  if (process.platform === 'win32') {
    return result.code !== null || result.signal !== null;
  }

  return result.code === 0 || result.signal === 'SIGTERM';
}
