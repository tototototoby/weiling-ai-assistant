import { readFile as readFileAsync } from 'node:fs/promises';
import { join } from 'node:path';

export interface GlobalEmailSecret {
  password: string;
  updatedAt: string;
}

export interface GlobalEmailSecretReaderOptions {
  env?: NodeJS.ProcessEnv;
  readFileImpl?: (path: string, encoding: 'utf8') => Promise<string>;
  workspaceRoot?: string;
}

export class GlobalEmailSecretReader {
  private readonly env: NodeJS.ProcessEnv;
  private readonly readFileImpl: (path: string, encoding: 'utf8') => Promise<string>;
  private readonly workspaceRoot: string | undefined;

  constructor(options: GlobalEmailSecretReaderOptions = {}) {
    this.env = options.env ?? process.env;
    this.readFileImpl = options.readFileImpl ?? ((path, encoding) => readFileAsync(path, encoding));
    this.workspaceRoot = options.workspaceRoot;
  }

  async read(): Promise<string | null> {
    if (this.env.EMAIL_SMTP_PASSWORD !== undefined) return this.env.EMAIL_SMTP_PASSWORD;
    const configuredPath = this.env.EMAIL_SMTP_PASSWORD_FILE?.trim();
    const path = configuredPath || (this.workspaceRoot
      ? join(this.workspaceRoot, 'storage', 'secrets', 'global-email.json')
      : null);
    if (!path) return null;
    try {
      const raw = await this.readFileImpl(path, 'utf8');
      if (configuredPath) return raw.replace(/\r?\n$/, '');
      const parsed = JSON.parse(raw) as Partial<GlobalEmailSecret>;
      return typeof parsed.password === 'string' && parsed.password.length > 0 ? parsed.password : null;
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
}

export async function readGlobalEmailSecret(workspaceRoot: string): Promise<GlobalEmailSecret | null> {
  const password = await new GlobalEmailSecretReader({ workspaceRoot }).read();
  return password ? { password, updatedAt: '' } : null;
}
