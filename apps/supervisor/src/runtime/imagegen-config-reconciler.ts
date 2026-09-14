import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GlobalImagegenConfigRepository } from '@weiling-ai/db';
import { resolveBotInstancePaths } from '@weiling-ai/shared';

type ConfigRepository = Pick<GlobalImagegenConfigRepository, 'find'>;

export interface ImagegenConfigReconcilerDependencies {
  configRepository: ConfigRepository;
  instancesRoot: string;
}

/**
 * Publishes the global Image2 credentials into each Bot's private secret file.
 * A disabled config removes the file so a stopped runtime cannot keep using a
 * stale key.
 */
export class ImagegenConfigReconciler {
  private readonly configRepository: ConfigRepository;
  private readonly instancesRoot: string;

  constructor(dependencies: ImagegenConfigReconcilerDependencies) {
    this.configRepository = dependencies.configRepository;
    this.instancesRoot = dependencies.instancesRoot;
  }

  async runOnce(botInstanceIds: readonly string[]): Promise<void> {
    const config = await this.configRepository.find();
    for (const botInstanceId of botInstanceIds) {
      await this.reconcileBot(botInstanceId, config);
    }
  }

  private async reconcileBot(
    botInstanceId: string,
    config: Awaited<ReturnType<ConfigRepository['find']>>,
  ): Promise<void> {
    const { dataDir } = resolveBotInstancePaths(this.instancesRoot, botInstanceId);
    const secretsDir = path.join(dataDir, 'secrets');
    const targetPath = path.join(secretsDir, 'imagegen.json');
    const endpoint = config?.endpoint?.trim() ?? '';
    const apiKey = config?.apiKey?.trim() ?? '';

    if (config?.enabled && endpoint && apiKey) {
      const payload = JSON.stringify({
        endpoint,
        apiKey,
        model: config.model,
      });
      let existing: string | null = null;
      try {
        existing = await readFile(targetPath, 'utf8');
      } catch (error) {
        if (!isMissingFileError(error)) {
          throw error;
        }
      }

      if (existing !== payload) {
        await mkdir(secretsDir, { recursive: true, mode: 0o700 });
        await writeFile(targetPath, payload, { mode: 0o600 });
      }
      return;
    }

    try {
      await unlink(targetPath);
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
