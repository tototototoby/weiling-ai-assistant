import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const FORCEFUL_SHUTDOWN_TIMEOUT_MS = 1_000;
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 3_000;
const PROCESS_EXIT_POLL_INTERVAL_MS = 100;

export type StopTrackedProcessResult = 'failed' | 'not_running' | 'stopped';

export function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}

export async function getProcessStartedAt(pid: number) {
  if (process.platform === 'win32') {
    return getWindowsProcessStartedAt(pid);
  }

  try {
    const { stdout } = await execFile('ps', ['-p', String(pid), '-o', 'lstart=']);
    return parseProcessStartedAt(stdout);
  } catch {
    return null;
  }
}

async function getWindowsProcessStartedAt(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }

  try {
    const { stdout } = await execFile('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`,
    ]);
    return parseProcessStartedAt(stdout);
  } catch {
    return null;
  }
}

export async function stopTrackedProcess(
  pid: number,
  expectedStartedAt: string,
): Promise<StopTrackedProcessResult> {
  const actualStartedAt = await getProcessStartedAt(pid);

  if (actualStartedAt !== expectedStartedAt) {
    return 'not_running';
  }

  if (!sendSignal(pid, 'SIGTERM')) {
    return isProcessAlive(pid) ? 'failed' : 'not_running';
  }

  if (await waitForProcessExit(pid, GRACEFUL_SHUTDOWN_TIMEOUT_MS)) {
    return 'stopped';
  }

  if (!sendSignal(pid, 'SIGKILL')) {
    return isProcessAlive(pid) ? 'failed' : 'not_running';
  }

  if (await waitForProcessExit(pid, FORCEFUL_SHUTDOWN_TIMEOUT_MS)) {
    return 'stopped';
  }

  return 'failed';
}

function sendSignal(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, PROCESS_EXIT_POLL_INTERVAL_MS);
    });
  }

  return !isProcessAlive(pid);
}

function parseProcessStartedAt(value: string) {
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    return null;
  }

  const timestamp = Date.parse(trimmedValue.replace(/\s+/g, ' '));

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString();
}
