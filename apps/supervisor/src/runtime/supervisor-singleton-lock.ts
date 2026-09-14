import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  getProcessStartedAt as getTrackedProcessStartedAt,
  isProcessAlive,
  stopTrackedProcess,
} from './process-identity';

const execFile = promisify(execFileCallback);

interface SupervisorLockFilePayload {
  pid: number;
  startedAt: string;
  workspaceRoot: string;
}

export function resolveSupervisorSingletonLockPath(workspaceRoot: string) {
  return path.join(workspaceRoot, 'storage', 'supervisor.lock');
}

export class SupervisorSingletonLock {
  private fileHandle: FileHandle | null = null;

  constructor(private readonly lockFilePath: string) {}

  async acquire() {
    if (this.fileHandle) {
      return;
    }

    await mkdir(path.dirname(this.lockFilePath), { recursive: true });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const fileHandle = await open(this.lockFilePath, 'wx');

        try {
          const startedAt = await getRequiredProcessStartedAt(process.pid);
          await fileHandle.writeFile(JSON.stringify({
            pid: process.pid,
            startedAt,
            workspaceRoot: inferWorkspaceRoot(this.lockFilePath),
          } satisfies SupervisorLockFilePayload));
          await fileHandle.sync();
        } catch (error) {
          await fileHandle.close();
          await rm(this.lockFilePath, { force: true });
          throw error;
        }

        this.fileHandle = fileHandle;
        return;
      } catch (error) {
        if (!isAlreadyExistsError(error)) {
          throw error;
        }

        const removedLock = await this.removeConflictingLockIfNeeded();

        if (!removedLock) {
          throw await this.createAlreadyLockedError();
        }
      }
    }

    throw await this.createAlreadyLockedError();
  }

  async release() {
    const fileHandle = this.fileHandle;
    this.fileHandle = null;

    if (!fileHandle) {
      return;
    }

    try {
      await fileHandle.close();
    } finally {
      await rm(this.lockFilePath, { force: true });
    }
  }

  private async removeConflictingLockIfNeeded() {
    const payload = await this.readLockFilePayload();

    if (!payload) {
      await rm(this.lockFilePath, { force: true });
      return true;
    }

    if (payload.pid === process.pid) {
      const actualStartedAt = await getTrackedProcessStartedAt(process.pid);

      if (!actualStartedAt || actualStartedAt === payload.startedAt) {
        return false;
      }

      await rm(this.lockFilePath, { force: true });
      return true;
    }

    if (!isProcessAlive(payload.pid)) {
      await rm(this.lockFilePath, { force: true });
      return true;
    }

    return this.stopExistingSupervisor(payload);
  }

  private async createAlreadyLockedError() {
    const payload = await this.readLockFilePayload();
    const ownerPid = payload?.pid ?? 'unknown';

    return new Error(
      `Supervisor singleton lock is already held by pid ${ownerPid}. Automatic replacement was not possible; stop the existing supervisor or remove the stale lock at ${this.lockFilePath}.`,
    );
  }

  private async readLockFilePayload(): Promise<SupervisorLockFilePayload | null> {
    try {
      const raw = await readFile(this.lockFilePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;

      if (!isSupervisorLockFilePayload(parsed)) {
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

  private async stopExistingSupervisor(payload: SupervisorLockFilePayload) {
    const actualStartedAt = await getTrackedProcessStartedAt(payload.pid);

    if (actualStartedAt !== payload.startedAt) {
      return false;
    }

    const processCommand = await getProcessCommand(payload.pid);

    if (!looksLikeSupervisorProcess(processCommand, payload.workspaceRoot)) {
      return false;
    }

    console.warn(
      `Existing supervisor pid ${payload.pid} is still running for ${payload.workspaceRoot}. Sending SIGTERM before startup.`,
    );

    if (await stopTrackedProcess(payload.pid, payload.startedAt) === 'stopped') {
      console.warn(`Previous supervisor pid ${payload.pid} stopped. Continuing startup.`);
      await rm(this.lockFilePath, { force: true });
      return true;
    }

    return false;
  }
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isSupervisorLockFilePayload(value: unknown): value is SupervisorLockFilePayload {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<SupervisorLockFilePayload>;
  return Number.isInteger(candidate.pid)
    && typeof candidate.startedAt === 'string'
    && typeof candidate.workspaceRoot === 'string';
}

function inferWorkspaceRoot(lockFilePath: string) {
  return path.dirname(path.dirname(lockFilePath));
}

async function getProcessCommand(pid: number) {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFile('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\" -ErrorAction Stop).CommandLine`,
      ]);
      const command = stdout.trim();
      return command.length > 0 ? command : null;
    } catch {
      return null;
    }
  }

  try {
    const { stdout } = await execFile('ps', ['-p', String(pid), '-o', 'command=']);
    const command = stdout.trim();

    return command.length > 0 ? command : null;
  } catch {
    return null;
  }
}

function looksLikeSupervisorProcess(command: string | null, workspaceRoot: string) {
  if (!command) {
    return false;
  }

  return command.includes('@weiling-ai/supervisor')
    || command.includes(`${path.sep}src${path.sep}index.ts`)
    || command.includes(`${path.sep}src${path.sep}index.js`)
    || command.includes(`${path.sep}dist${path.sep}index.js`)
    || command.includes(`watch ${path.join('src', 'index.ts')}`)
    || (command.includes(workspaceRoot) && command.includes(`${path.sep}supervisor${path.sep}`));
}

async function getRequiredProcessStartedAt(pid: number) {
  const startedAt = await getTrackedProcessStartedAt(pid);

  if (!startedAt) {
    throw new Error(`Unable to determine process start time for pid ${pid}.`);
  }

  return startedAt;
}
