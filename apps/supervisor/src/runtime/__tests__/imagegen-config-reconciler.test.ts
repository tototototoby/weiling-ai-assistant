import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn(async (
      filePath: string,
      data: string,
      options?: object,
    ) => actual.writeFile(filePath, data, options)),
  };
});

import { ImagegenConfigReconciler } from '../imagegen-config-reconciler';

const tempDirs: string[] = [];
const now = new Date('2026-08-24T00:00:00.000Z');

afterEach(async () => {
  vi.mocked(writeFile).mockClear();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, {
    force: true,
    recursive: true,
  })));
});

describe('ImagegenConfigReconciler', () => {
  it('writes private imagegen.json secrets for every Bot', async () => {
    const instancesRoot = await createInstancesRoot();
    const configRepository = {
      find: vi.fn().mockResolvedValue(createConfig()),
    };

    await new ImagegenConfigReconciler({
      configRepository: configRepository as never,
      instancesRoot,
    }).runOnce(['bot_1', 'bot_2']);

    for (const botInstanceId of ['bot_1', 'bot_2']) {
      const secretPath = path.join(
        instancesRoot,
        botInstanceId,
        'data',
        'secrets',
        'imagegen.json',
      );
      await expect(JSON.parse(await readFile(secretPath, 'utf8'))).toEqual({
        endpoint: 'https://imagegen.example.com/v1',
        apiKey: 'sk-imagegen-test',
        model: 'gpt-image-2',
      });
    }
    expect(configRepository.find).toHaveBeenCalledTimes(1);
  });

  it('removes an existing secret when the config is disabled or missing', async () => {
    const instancesRoot = await createInstancesRoot();
    const secretPath = path.join(
      instancesRoot,
      'bot_1',
      'data',
      'secrets',
      'imagegen.json',
    );
    await mkdir(path.dirname(secretPath), { recursive: true });
    await writeFile(secretPath, JSON.stringify({ endpoint: 'old', apiKey: 'old' }));

    await new ImagegenConfigReconciler({
      configRepository: { find: vi.fn().mockResolvedValue(null) } as never,
      instancesRoot,
    }).runOnce(['bot_1']);

    await expect(readFile(secretPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not rewrite a file that already contains the current secret', async () => {
    const instancesRoot = await createInstancesRoot();
    const config = createConfig();
    const secretPath = path.join(
      instancesRoot,
      'bot_1',
      'data',
      'secrets',
      'imagegen.json',
    );
    await mkdir(path.dirname(secretPath), { recursive: true });
    await writeFile(secretPath, JSON.stringify({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      model: config.model,
    }));
    vi.mocked(writeFile).mockClear();

    await new ImagegenConfigReconciler({
      configRepository: { find: vi.fn().mockResolvedValue(config) } as never,
      instancesRoot,
    }).runOnce(['bot_1']);

    expect(writeFile).not.toHaveBeenCalled();
  });
});

interface ImagegenConfigFixture {
  apiKey: string;
  createdAt: Date;
  enabled: boolean;
  endpoint: string;
  id: string;
  model: string;
  observedRevision: number | null;
  revision: number;
  updatedAt: Date;
  updatedByUserId: string;
}

function createConfig(
  overrides: Partial<ImagegenConfigFixture> = {},
): ImagegenConfigFixture {
  return {
    apiKey: 'sk-imagegen-test',
    createdAt: now,
    enabled: true,
    endpoint: 'https://imagegen.example.com/v1',
    id: 'global',
    model: 'gpt-image-2',
    observedRevision: null,
    revision: 1,
    updatedAt: now,
    updatedByUserId: 'admin_1',
    ...overrides,
  };
}

async function createInstancesRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'weiling-imagegen-config-'));
  tempDirs.push(root);
  return root;
}
