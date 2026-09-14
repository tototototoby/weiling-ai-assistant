import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveBotInstancePaths } from '@weiling-ai/shared';

export interface WeclawsBridgeReconcilerDependencies {
  apiToken: string;
  instancesRoot: string;
  internalPort: number;
  supervisorServiceName?: string;
}

/**
 * Writes each Bot's private internal-bridge credentials into
 * `data/secrets/weclaws-bridge.json` so skill scripts running inside the
 * remote sandbox can reach the supervisor's internal HTTP API without relying
 * on environment propagation.
 */
export class WeclawsBridgeReconciler {
  private readonly apiToken: string;
  private readonly instancesRoot: string;
  private readonly internalUrl: string;

  constructor(dependencies: WeclawsBridgeReconcilerDependencies) {
    this.apiToken = dependencies.apiToken;
    this.instancesRoot = dependencies.instancesRoot;
    const serviceName = dependencies.supervisorServiceName ?? 'supervisor';
    this.internalUrl = `http://${serviceName}:${dependencies.internalPort}`;
  }

  async runOnce(botInstanceIds: readonly string[]): Promise<void> {
    if (!this.apiToken) {
      return;
    }
    for (const botInstanceId of botInstanceIds) {
      await this.reconcileBot(botInstanceId);
    }
  }

  private async reconcileBot(botInstanceId: string): Promise<void> {
    const { dataDir } = resolveBotInstancePaths(this.instancesRoot, botInstanceId);
    const secretsDir = path.join(dataDir, 'secrets');
    const targetPath = path.join(secretsDir, 'weclaws-bridge.json');
    await mkdir(secretsDir, { recursive: true, mode: 0o700 });
    await writeFile(
      targetPath,
      JSON.stringify({
        botInstanceId,
        internalUrl: this.internalUrl,
        apiToken: this.apiToken,
      }),
      { encoding: 'utf8', mode: 0o600 },
    );
  }

  async removeAll(botInstanceIds: readonly string[]): Promise<void> {
    for (const botInstanceId of botInstanceIds) {
      const { dataDir } = resolveBotInstancePaths(this.instancesRoot, botInstanceId);
      await rm(path.join(dataDir, 'secrets', 'weclaws-bridge.json'), {
        force: true,
      }).catch(() => undefined);
    }
  }
}
