import { cp, lstat, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CURRENT_DATA_ROOT_ENV = 'WEILING_DATA_ROOT';
export const LEGACY_DATA_ROOT_ENV = 'WECLAWS_DATA_ROOT';

/**
 * Resolve the source and destination roots without mutating the environment.
 * The legacy variable is intentionally accepted only as a source hint; a
 * migration always needs an explicit current destination.
 */
export function resolveDataRoots(
  env = process.env,
  overrides = {},
) {
  const source = normalizeRoot(overrides.from ?? env[LEGACY_DATA_ROOT_ENV], 'source');
  const destination = normalizeRoot(overrides.to ?? env[CURRENT_DATA_ROOT_ENV], 'destination');

  if (!source) {
    throw new Error(
      `Missing source root. Pass --from <path> or set ${LEGACY_DATA_ROOT_ENV}.`,
    );
  }

  if (!destination) {
    throw new Error(
      `Missing destination root. Pass --to <path> or set ${CURRENT_DATA_ROOT_ENV}.`,
    );
  }

  if (samePath(source, destination)) {
    throw new Error('Source and destination roots must be different paths.');
  }

  if (isPathInside(destination, source) || isPathInside(source, destination)) {
    throw new Error('Source and destination roots must not contain one another.');
  }

  return {
    destination,
    legacySourceEnv: !overrides.from && Boolean(env[LEGACY_DATA_ROOT_ENV]),
    source,
  };
}

/**
 * Copy a deployment data root into a new root. The default is a read-only
 * preflight; callers must pass `apply: true` to copy anything. Existing files
 * in the destination are never overwritten.
 */
export async function migrateDataRoot({
  apply = false,
  from,
  log = console.log,
  to,
} = {}) {
  const roots = resolveDataRoots(process.env, { from, to });
  await assertDirectory(roots.source, 'Source root');
  await assertDestination(roots.destination);

  const entries = await collectEntries(roots.source);
  const conflicts = await findConflicts(roots.destination, entries);

  log(`Source:      ${roots.source}`);
  log(`Destination: ${roots.destination}`);
  log(`Entries:     ${entries.length}`);

  if (roots.legacySourceEnv) {
    log(
      `Warning: ${LEGACY_DATA_ROOT_ENV} is supported for one release only; set ${CURRENT_DATA_ROOT_ENV} for future runs.`,
    );
  }

  if (conflicts.length > 0) {
    throw new Error(
      `Destination contains ${conflicts.length} existing path(s); no files were changed. First conflict: ${conflicts[0]}`,
    );
  }

  if (!apply) {
    log('Dry run: no files were changed. Re-run with --apply to copy the data.');
    return { ...roots, applied: false, conflicts, entries };
  }

  await mkdir(roots.destination, { recursive: true, mode: 0o700 });
  const topLevelEntries = entries.filter((entry) => !entry.relativePath.includes(path.sep));
  for (const entry of topLevelEntries) {
    await cp(
      path.join(roots.source, entry.relativePath),
      path.join(roots.destination, entry.relativePath),
      {
        errorOnExist: true,
        force: false,
        preserveTimestamps: true,
        recursive: true,
      },
    );
  }

  const copiedEntries = await collectEntries(roots.destination);
  verifyCopiedEntries(entries, copiedEntries);
  log(`Applied:    copied ${entries.length} path(s); the source was kept unchanged.`);
  return { ...roots, applied: true, conflicts, entries };
}

function normalizeRoot(value, label) {
  if (value === undefined || value === null || !String(value).trim()) {
    return null;
  }

  const resolved = path.resolve(String(value).trim());
  const parsed = path.parse(resolved);
  if (resolved === parsed.root) {
    throw new Error(`${label} root must not be a filesystem root: ${resolved}`);
  }
  return resolved;
}

async function assertDirectory(directoryPath, label) {
  const stats = await lstat(directoryPath).catch((error) => {
    if (error?.code === 'ENOENT') {
      throw new Error(`${label} does not exist: ${directoryPath}`);
    }
    throw error;
  });
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} must be a regular directory: ${directoryPath}`);
  }
}

async function assertDestination(directoryPath) {
  try {
    await assertDirectory(directoryPath, 'Destination root');
  } catch (error) {
    if (error?.code === 'ENOENT' || String(error?.message).includes('does not exist')) {
      return;
    }
    throw error;
  }
}

async function collectEntries(rootDirectory) {
  const entries = [];
  const walk = async (relativePath) => {
    const absolutePath = path.join(rootDirectory, relativePath);
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink()) {
      throw new Error(`Symbolic links are not supported by the safe migration: ${absolutePath}`);
    }

    if (stats.isDirectory()) {
      entries.push({ relativePath, size: 0, type: 'directory' });
      const children = await readdir(absolutePath, { withFileTypes: true });
      for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
        await walk(path.join(relativePath, child.name));
      }
      return;
    }

    if (!stats.isFile()) {
      throw new Error(`Unsupported filesystem entry in migration root: ${absolutePath}`);
    }

    entries.push({ relativePath, size: stats.size, type: 'file' });
  };

  const children = await readdir(rootDirectory, { withFileTypes: true });
  for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
    await walk(child.name);
  }
  return entries;
}

async function findConflicts(destinationRoot, entries) {
  const conflicts = [];
  for (const entry of entries) {
    try {
      await lstat(path.join(destinationRoot, entry.relativePath));
      conflicts.push(entry.relativePath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return conflicts;
}

function verifyCopiedEntries(expectedEntries, actualEntries) {
  const actualByPath = new Map(actualEntries.map((entry) => [entry.relativePath, entry]));
  for (const expected of expectedEntries) {
    const actual = actualByPath.get(expected.relativePath);
    if (!actual || actual.type !== expected.type || actual.size !== expected.size) {
      throw new Error(`Migration verification failed for ${expected.relativePath}`);
    }
  }
}

function samePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function isPathInside(candidate, parent) {
  const relativePath = path.relative(path.resolve(parent), path.resolve(candidate));
  return Boolean(relativePath)
    && !relativePath.startsWith(`..${path.sep}`)
    && relativePath !== '..'
    && !path.isAbsolute(relativePath);
}

function parseArgs(argv) {
  const options = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') {
      options.apply = true;
      continue;
    }
    if (argument === '--from' || argument === '--to') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a path.`);
      }
      options[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function printUsage() {
  console.log('Usage: node scripts/migrate-weclaws-data.mjs --from <old-root> --to <new-root> [--apply]');
  console.log('       Set WECLAWS_DATA_ROOT and WEILING_DATA_ROOT instead of passing both paths.');
  console.log('       The default is a dry run; --apply is required to copy files.');
}

async function runCli() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printUsage();
      return;
    }
    await migrateDataRoot(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printUsage();
    process.exitCode = 1;
  }
}

const entrypointPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entrypointPath === fileURLToPath(import.meta.url)) {
  await runCli();
}
