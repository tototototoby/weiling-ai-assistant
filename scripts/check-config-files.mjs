import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const excludedDirectories = new Set([
  '.git',
  '.next',
  'coverage',
  'dist',
  'node_modules',
]);

const files = await collectConfigFiles(repoRoot);
const failures = [];

for (const file of files) {
  const content = await readFile(file, 'utf8');

  try {
    if (file.endsWith('.json')) {
      JSON.parse(content);
    } else {
      const document = parseDocument(content, { uniqueKeys: true });
      if (document.errors.length > 0) {
        throw new Error(document.errors.map((error) => error.message).join('; '));
      }
    }
  } catch (error) {
    failures.push({
      file: path.relative(repoRoot, file).replaceAll('\\', '/'),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`${failure.file}: ${failure.error}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(`Parsed ${files.length} JSON/YAML configuration files.\n`);
}

async function collectConfigFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) {
        files.push(...await collectConfigFiles(path.join(directory, entry.name)));
      }
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (entry.isFile() && ['.json', '.yaml', '.yml'].includes(extension)) {
      files.push(path.join(directory, entry.name));
    }
  }

  return files;
}
