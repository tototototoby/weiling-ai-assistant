import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { resolveBotInstancePaths } from '../bot-instance-paths';

const execFile = promisify(execFileCallback);

interface ManagedSkillsLockFilePayload {
  pid: number;
  startedAt: string;
}

export interface ManagedSkillsLockHandle {
  release(): Promise<void>;
}

export function resolveManagedSkillsLockPath(instancesRoot: string, botInstanceId: string) {
  return path.join(resolveBotInstancePaths(instancesRoot, botInstanceId).dataDir, '.weclaws-managed-skills.lock');
}

export async function acquireManagedSkillsLock(lockFilePath: string): Promise<ManagedSkillsLockHandle | null> {
  await mkdir(path.dirname(lockFilePath), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fileHandle = await open(lockFilePath, 'wx');

      try {
        const payload: ManagedSkillsLockFilePayload = {
          pid: process.pid,
          startedAt: await getRequiredProcessStartedAt(process.pid),
        };

        await fileHandle.writeFile(JSON.stringify(payload));
        await fileHandle.sync();
      } catch (error) {
        await fileHandle.close();
        await rm(lockFilePath, { force: true });
        throw error;
      }

      return {
        async release() {
          await releaseLockFile(fileHandle, lockFilePath);
        },
      };
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }

      const removedStaleLock = await removeStaleLockFile(lockFilePath);

      if (!removedStaleLock) {
        return null;
      }
    }
  }

  return null;
}

async function releaseLockFile(fileHandle: FileHandle, lockFilePath: string) {
  try {
    await fileHandle.close();
  } finally {
    await rm(lockFilePath, { force: true });
  }
}

async function removeStaleLockFile(lockFilePath: string) {
  const payload = await readManagedSkillsLockPayload(lockFilePath);

  if (!payload) {
    await rm(lockFilePath, { force: true });
    return true;
  }

  const actualStartedAt = await getProcessStartedAt(payload.pid);

  if (actualStartedAt !== payload.startedAt) {
    await rm(lockFilePath, { force: true });
    return true;
  }

  return false;
}

async function readManagedSkillsLockPayload(lockFilePath: string): Promise<ManagedSkillsLockFilePayload | null> {
  try {
    const raw = await readFile(lockFilePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;

    if (!isManagedSkillsLockPayload(parsed)) {
      return null;
    }

    return parsed;
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    return null;
  }
}

function isManagedSkillsLockPayload(value: unknown): value is ManagedSkillsLockFilePayload {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ManagedSkillsLockFilePayload>;

  return Number.isInteger(candidate.pid)
    && typeof candidate.startedAt === 'string'
    && candidate.startedAt.length > 0;
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function getRequiredProcessStartedAt(pid: number) {
  const startedAt = await getProcessStartedAt(pid);

  if (!startedAt) {
    throw new Error(`Unable to determine process start time for pid ${pid}.`);
  }

  return startedAt;
}

async function getProcessStartedAt(pid: number) {
  if (process.platform === 'win32') {
    return getWindowsProcessStartedAt(pid);
  }

  try {
    const { stdout } = await execFile('ps', ['-p', String(pid), '-o', 'lstart=']);
    const timestamp = Date.parse(stdout.trim().replace(/\s+/g, ' '));

    if (Number.isNaN(timestamp)) {
      return null;
    }

    return new Date(timestamp).toISOString();
  } catch {
    return null;
  }
}

async function getWindowsProcessStartedAt(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }

  const script = [
    `$process = Get-Process -Id ${pid} -ErrorAction Stop`,
    "$process.StartTime.ToUniversalTime().ToString('o')",
  ].join('; ');

  try {
    const { stdout } = await execFile('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ]);
    const timestamp = Date.parse(stdout.trim());

    if (Number.isNaN(timestamp)) {
      return null;
    }

    return new Date(timestamp).toISOString();
  } catch {
    return null;
  }
}
