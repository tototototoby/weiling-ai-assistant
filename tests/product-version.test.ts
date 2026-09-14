import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkProductVersion,
  readProductVersion,
  syncProductVersion,
} from '../scripts/product-version.mjs';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('product version management', () => {
  it('reports mismatched package versions and syncs them from VERSION', async () => {
    const repoDir = await createRepoFixture('0.3.0');

    await expect(checkProductVersion(repoDir)).resolves.toMatchObject({
      mismatches: [
        { currentVersion: '0.0.1', expectedVersion: '0.3.0', relativePath: 'apps/supervisor/package.json' },
        { currentVersion: '0.0.1', expectedVersion: '0.3.0', relativePath: 'apps/web/package.json' },
        { currentVersion: '0.0.1', expectedVersion: '0.3.0', relativePath: 'package.json' },
        { currentVersion: '0.0.1', expectedVersion: '0.3.0', relativePath: 'packages/db/package.json' },
        { currentVersion: '0.0.1', expectedVersion: '0.3.0', relativePath: 'packages/shared/package.json' },
      ],
      version: '0.3.0',
    });

    await expect(syncProductVersion(repoDir)).resolves.toMatchObject({
      updatedFiles: [
        'apps/supervisor/package.json',
        'apps/web/package.json',
        'package.json',
        'packages/db/package.json',
        'packages/shared/package.json',
      ],
      version: '0.3.0',
    });

    await expect(checkProductVersion(repoDir)).resolves.toEqual({
      mismatches: [],
      version: '0.3.0',
    });

    await expect(readJson(join(repoDir, 'package.json'))).resolves.toMatchObject({
      version: '0.3.0',
    });
    await expect(readJson(join(repoDir, 'apps/web/package.json'))).resolves.toMatchObject({
      version: '0.3.0',
    });
  });

  it('trims trailing whitespace from VERSION', async () => {
    const repoDir = await createRepoFixture('1.2.3\n');

    await expect(readProductVersion(repoDir)).resolves.toBe('1.2.3');
  });

  it('rejects invalid VERSION contents', async () => {
    const repoDir = await createRepoFixture('release-2026');

    await expect(readProductVersion(repoDir)).rejects.toThrow(
      'VERSION must contain a valid semver version without a leading "v".',
    );
  });
});

async function createRepoFixture(version: string) {
  const repoDir = await mkdtemp(join(tmpdir(), 'weiling-product-version-'));
  tempDirs.push(repoDir);

  await Promise.all([
    writeFile(join(repoDir, 'VERSION'), version),
    writePackageJson(join(repoDir, 'package.json'), 'weiling-ai-assistant', '0.0.1'),
    writePackageJson(join(repoDir, 'apps/web/package.json'), '@weiling-ai/web', '0.0.1'),
    writePackageJson(join(repoDir, 'apps/supervisor/package.json'), '@weiling-ai/supervisor', '0.0.1'),
    writePackageJson(join(repoDir, 'packages/db/package.json'), '@weiling-ai/db', '0.0.1'),
    writePackageJson(join(repoDir, 'packages/shared/package.json'), '@weiling-ai/shared', '0.0.1'),
  ]);

  return repoDir;
}

async function readJson(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as { version: string };
}

async function writePackageJson(path: string, name: string, version: string) {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({
      name,
      private: true,
      version,
    }, null, 2) + '\n',
  );
}
