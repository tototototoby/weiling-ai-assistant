import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SECRET_FILE_NAME = 'global-email.json';

export interface GlobalEmailSecret {
  password: string;
  updatedAt: string;
}

export function getGlobalEmailSecretPath(workspaceRoot: string): string {
  return join(workspaceRoot, 'storage', 'secrets', SECRET_FILE_NAME);
}

export async function readGlobalEmailSecret(workspaceRoot: string): Promise<GlobalEmailSecret | null> {
  try {
    const raw = await readFile(getGlobalEmailSecretPath(workspaceRoot), 'utf8');
    const parsed = JSON.parse(raw) as Partial<GlobalEmailSecret>;
    return typeof parsed.password === 'string' && parsed.password.length > 0
      ? { password: parsed.password, updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '' }
      : null;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeGlobalEmailSecret(workspaceRoot: string, password: string): Promise<void> {
  if (!password) throw new Error('Email password must not be empty.');
  const directory = join(workspaceRoot, 'storage', 'secrets');
  const target = getGlobalEmailSecretPath(workspaceRoot);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(temporary, `${JSON.stringify({ password, updatedAt: new Date().toISOString() })}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await chmod(temporary, 0o600).catch(() => undefined);
  await rename(temporary, target);
  await chmod(target, 0o600).catch(() => undefined);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
