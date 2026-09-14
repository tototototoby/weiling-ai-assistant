import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PRODUCT_VERSION_FILENAME = 'VERSION';
const PACKAGE_JSON_FILENAME = 'package.json';
const WORKSPACE_ROOTS = ['apps', 'packages'];
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function toRepoRelative(rootDir, targetPath) {
  return relative(rootDir, targetPath).replaceAll('\\', '/');
}

export async function readProductVersion(rootDir) {
  const versionPath = join(rootDir, PRODUCT_VERSION_FILENAME);
  const rawVersion = await readFile(versionPath, 'utf8');
  const version = rawVersion.trim();

  if (!SEMVER_PATTERN.test(version)) {
    throw new Error('VERSION must contain a valid semver version without a leading "v".');
  }

  return version;
}

export async function checkProductVersion(rootDir) {
  const version = await readProductVersion(rootDir);
  const packageJsonPaths = await listPackageJsonPaths(rootDir);
  const mismatches = [];

  for (const packageJsonPath of packageJsonPaths) {
    const packageJson = await readPackageJson(packageJsonPath);

    if (packageJson.version !== version) {
      mismatches.push({
        currentVersion: packageJson.version,
        expectedVersion: version,
        relativePath: toRepoRelative(rootDir, packageJsonPath),
      });
    }
  }

  return {
    mismatches,
    version,
  };
}

export async function syncProductVersion(rootDir) {
  const version = await readProductVersion(rootDir);
  const packageJsonPaths = await listPackageJsonPaths(rootDir);
  const updatedFiles = [];

  for (const packageJsonPath of packageJsonPaths) {
    const packageJson = await readPackageJson(packageJsonPath);

    if (packageJson.version === version) {
      continue;
    }

    packageJson.version = version;
    await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
    updatedFiles.push(toRepoRelative(rootDir, packageJsonPath));
  }

  return {
    updatedFiles,
    version,
  };
}

async function listPackageJsonPaths(rootDir) {
  const packageJsonPaths = [join(rootDir, PACKAGE_JSON_FILENAME)];

  for (const workspaceRoot of WORKSPACE_ROOTS) {
    const workspaceRootPath = join(rootDir, workspaceRoot);
    const entries = await readdir(workspaceRootPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      packageJsonPaths.push(join(workspaceRootPath, entry.name, PACKAGE_JSON_FILENAME));
    }
  }

  return packageJsonPaths.sort((left, right) => {
    return toRepoRelative(rootDir, left).localeCompare(toRepoRelative(rootDir, right));
  });
}

async function readPackageJson(packageJsonPath) {
  return JSON.parse(await readFile(packageJsonPath, 'utf8'));
}

async function runCli() {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const command = process.argv[2];

  if (command === 'check') {
    const result = await checkProductVersion(repoRoot);

    if (result.mismatches.length === 0) {
      process.stdout.write(`All package versions match VERSION (${result.version}).\n`);
      return;
    }

    for (const mismatch of result.mismatches) {
      process.stderr.write(
        `${mismatch.relativePath}: expected ${mismatch.expectedVersion}, found ${mismatch.currentVersion}\n`,
      );
    }

    process.exitCode = 1;
    return;
  }

  if (command === 'sync') {
    const result = await syncProductVersion(repoRoot);
    process.stdout.write(
      `Synced ${result.updatedFiles.length} package file(s) to VERSION ${result.version}.\n`,
    );
    return;
  }

  process.stderr.write('Usage: node scripts/product-version.mjs <check|sync>\n');
  process.exitCode = 1;
}

const isEntrypoint = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  await runCli();
}
