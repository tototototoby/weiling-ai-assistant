import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDataRoot, resolveDataRoots } from '../scripts/migrate-weclaws-data.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('safe data-root migration', () => {
  it('prefers the new destination variable while accepting the legacy source variable', () => {
    const source = 'C:\\legacy\\weiling-data';
    const destination = 'C:\\current\\weiling-data';
    expect(resolveDataRoots({ WECLAWS_DATA_ROOT: source, WEILING_DATA_ROOT: destination })).toMatchObject({
      destination,
      legacySourceEnv: true,
      source,
    });
  });

  it('performs a dry run without creating or modifying the destination', async () => {
    const { source, destination } = await createFixture();
    const logs = [];

    const result = await migrateDataRoot({ from: source, log: (message) => logs.push(message), to: destination });

    expect(result.applied).toBe(false);
    await expect(readFile(join(source, 'sqlite', 'db.sqlite'), 'utf8')).resolves.toBe('sqlite-data');
    await expect(readFile(join(destination, 'sqlite', 'db.sqlite'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(logs.at(-1)).toContain('Dry run');
  });

  it('copies the complete tree on --apply, keeps the source, and refuses a second overwrite', async () => {
    const { source, destination } = await createFixture();

    const result = await migrateDataRoot({ apply: true, from: source, to: destination, log: () => undefined });

    expect(result.applied).toBe(true);
    await expect(readFile(join(destination, 'sqlite', 'db.sqlite'), 'utf8')).resolves.toBe('sqlite-data');
    await expect(readFile(join(destination, 'instances', 'bot-1', 'workspace', 'notes.txt'), 'utf8')).resolves.toBe('notes');
    await expect(readFile(join(source, 'instances', 'bot-1', 'workspace', 'notes.txt'), 'utf8')).resolves.toBe('notes');
    await expect(
      migrateDataRoot({ apply: true, from: source, to: destination, log: () => undefined }),
    ).rejects.toThrow('Destination contains');
    await expect(readFile(join(destination, 'sqlite', 'db.sqlite'), 'utf8')).resolves.toBe('sqlite-data');
  });
});

async function createFixture() {
  const root = join(tmpdir(), `weiling-data-migration-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(root);
  temporaryDirectories.push(root);
  const source = join(root, 'old');
  const destination = join(root, 'new');
  await mkdir(join(source, 'sqlite'), { recursive: true });
  await mkdir(join(source, 'instances', 'bot-1', 'workspace'), { recursive: true });
  await writeFile(join(source, 'sqlite', 'db.sqlite'), 'sqlite-data');
  await writeFile(join(source, 'instances', 'bot-1', 'workspace', 'notes.txt'), 'notes');
  return { destination, source };
}
