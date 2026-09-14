import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveBotInstancePaths } from '@weiling-ai/shared';

export const QWEN_VISION_MODEL = 'qwen-vl-max';
export const QWEN_VISION_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

export interface QwenVisionProvisionResult {
  provisioned: boolean;
  reason: 'no-api-key' | 'already-configured' | 'provisioned';
}

/**
 * Ensures a Bot has its private qwen-vision.json secret before the runtime
 * starts. Uses the globally configured DashScope key only when the Bot has no
 * existing per-Bot override; never overwrites an existing configuration.
 */
export async function ensureQwenVisionSecret(
  instancesRoot: string,
  botInstanceId: string,
  apiKey: string | undefined,
): Promise<QwenVisionProvisionResult> {
  const trimmed = apiKey?.trim() ?? '';

  if (!trimmed) {
    return { provisioned: false, reason: 'no-api-key' };
  }

  const { dataDir } = resolveBotInstancePaths(instancesRoot, botInstanceId);
  const secretsDir = path.join(dataDir, 'secrets');
  const targetPath = path.join(secretsDir, 'qwen-vision.json');

  try {
    await readFile(targetPath, 'utf8');
    return { provisioned: false, reason: 'already-configured' };
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  await mkdir(secretsDir, { recursive: true, mode: 0o700 });
  const payload = `${JSON.stringify({
    version: 1,
    provider: 'dashscope',
    api_key: trimmed,
    model: QWEN_VISION_MODEL,
    base_url: QWEN_VISION_BASE_URL,
  }, null, 2)}\n`;

  await writeFile(targetPath, payload, { mode: 0o600 });
  return { provisioned: true, reason: 'provisioned' };
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
