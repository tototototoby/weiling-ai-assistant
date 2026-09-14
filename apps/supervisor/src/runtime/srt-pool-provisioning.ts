import type {
  BotSandboxRuntimePoolRepository,
  BotSandboxRuntimePoolRecord,
} from '@weiling-ai/db';
import type { SandboxRuntimePoolDefaults } from '@weiling-ai/shared';
import { writeSandboxRuntimePoolConfigFile } from './srt-pool-config-file';

export interface EnsureBotSandboxRuntimePoolInput {
  botInstanceId: string;
  defaults: SandboxRuntimePoolDefaults;
  repository: BotSandboxRuntimePoolRepository;
}

export interface RenderAllSandboxRuntimePoolsInput {
  filePath: string;
  now?: Date;
  repository: BotSandboxRuntimePoolRepository;
  serviceHost: string;
  workspaceMapDir: string;
}

export async function ensureBotSandboxRuntimePool(
  input: EnsureBotSandboxRuntimePoolInput,
): Promise<BotSandboxRuntimePoolRecord> {
  return input.repository.ensureForBot({
    botInstanceId: input.botInstanceId,
    defaults: input.defaults,
  });
}

export async function renderAllSandboxRuntimePools(input: RenderAllSandboxRuntimePoolsInput): Promise<void> {
  const pools = await input.repository.listAll();

  await writeSandboxRuntimePoolConfigFile({
    filePath: input.filePath,
    now: input.now,
    pools,
    serviceHost: input.serviceHost,
    workspaceMapDir: input.workspaceMapDir,
  });
}
