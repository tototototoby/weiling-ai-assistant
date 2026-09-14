import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureQwenVisionSecret } from '../qwen-vision-provisioner';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

async function createHarness() {
  const instancesRoot = await mkdtemp(join(tmpdir(), 'weiling-qwen-provision-'));
  tempDirs.push(instancesRoot);
  return { instancesRoot };
}

describe('ensureQwenVisionSecret', () => {
  it('does nothing when no global API key is configured', async () => {
    const { instancesRoot } = await createHarness();

    await expect(ensureQwenVisionSecret(instancesRoot, 'bot_1', undefined)).resolves.toEqual({
      provisioned: false,
      reason: 'no-api-key',
    });
    await expect(ensureQwenVisionSecret(instancesRoot, 'bot_1', '   ')).resolves.toEqual({
      provisioned: false,
      reason: 'no-api-key',
    });
  });

  it('provisions a private qwen-vision.json when the Bot has none', async () => {
    const { instancesRoot } = await createHarness();
    const secretPath = join(instancesRoot, 'bot_1', 'data', 'secrets', 'qwen-vision.json');

    await expect(
      ensureQwenVisionSecret(instancesRoot, 'bot_1', 'sk-test-key'),
    ).resolves.toEqual({
      provisioned: true,
      reason: 'provisioned',
    });

    const config = JSON.parse(await readFile(secretPath, 'utf8')) as Record<string, unknown>;
    expect(config).toMatchObject({
      version: 1,
      provider: 'dashscope',
      api_key: 'sk-test-key',
      model: 'qwen-vl-max',
      base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });
  });

  it('never overwrites an existing per-Bot configuration', async () => {
    const { instancesRoot } = await createHarness();
    const secretPath = join(instancesRoot, 'bot_1', 'data', 'secrets', 'qwen-vision.json');
    await mkdir(join(instancesRoot, 'bot_1', 'data', 'secrets'), { recursive: true });
    await writeFile(
      secretPath,
      JSON.stringify({ version: 1, provider: 'dashscope', api_key: 'sk-custom', model: 'qwen-vl-plus' }),
    );

    await expect(
      ensureQwenVisionSecret(instancesRoot, 'bot_1', 'sk-global'),
    ).resolves.toEqual({
      provisioned: false,
      reason: 'already-configured',
    });

    const config = JSON.parse(await readFile(secretPath, 'utf8')) as Record<string, unknown>;
    expect(config.api_key).toBe('sk-custom');
    expect(config.model).toBe('qwen-vl-plus');
  });
});
