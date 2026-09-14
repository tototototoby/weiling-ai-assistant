#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  installSessionSecurityOverrides,
  installWorkspacePathOverride,
} from './workspace-root-override.mjs';

loadEnvFile();

const sandboxRuntimePackageRoot = resolveSandboxRuntimePackageRoot();
process.env.WECLAWS_SANDBOX_RUNTIME_PACKAGE_ROOT = sandboxRuntimePackageRoot;
process.env.NODE_OPTIONS = appendNodeOption(
  process.env.NODE_OPTIONS,
  `--import=${new URL('./worker-bootstrap.mjs', import.meta.url).href}`,
);

const { WorkspaceManager } = await importRuntimeModule('dist/core/WorkspaceManager.js');
const { SandboxProcessPool } = await importRuntimeModule('dist/core/SandboxProcessPool.js');
const { ConfigValidationError } = await importRuntimeModule('dist/utils/errors.js');

installWorkspacePathOverride({
  WorkspaceManager,
  workspaceMapFile: process.env.SANDBOX_WORKSPACE_MAP_FILE ?? null,
});
installSessionSecurityOverrides({
  ConfigValidationError,
  SandboxProcessPool,
  workspaceMapFile: process.env.SANDBOX_WORKSPACE_MAP_FILE ?? null,
});

const [
  { SandboxAPI },
  { loadConfig },
  { validateConfig },
  { logger },
] = await Promise.all([
  importRuntimeModule('dist/api/SandboxAPI.js'),
  importRuntimeModule('dist/config/default.js'),
  importRuntimeModule('dist/config/validator.js'),
  importRuntimeModule('dist/utils/logger.js'),
]);

async function main() {
  try {
    const config = loadConfig();
    validateConfig(config);
    logger.info({ config }, 'Configuration loaded and validated');

    if (process.env.SANDBOX_WORKSPACE_MAP_FILE) {
      logger.info({
        workspaceMapFile: process.env.SANDBOX_WORKSPACE_MAP_FILE,
      }, 'Installed weiling sandbox workspace override');
    }

    const api = new SandboxAPI({
      ...config,
      auth: {
        enabled: process.env.AUTH_ENABLED === 'true',
        apiKey: process.env.API_KEY,
      },
      rateLimit: {
        enabled: process.env.RATE_LIMIT_ENABLED === 'true',
        max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
      },
      socketio: {
        enabled: true,
        cors: {
          origin: process.env.CORS_ORIGIN || '*',
          credentials: true,
        },
      },
    });

    await api.start();

    const shutdown = async (signal) => {
      logger.info({ signal }, 'Received shutdown signal');

      try {
        await api.stop();
        process.exit(0);
      } catch (error) {
        logger.error({ err: error }, 'Error during shutdown');
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => {
      void shutdown('SIGTERM');
    });
    process.on('SIGINT', () => {
      void shutdown('SIGINT');
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

await main();

async function importRuntimeModule(relativePath) {
  return import(pathToFileURL(join(sandboxRuntimePackageRoot, relativePath)).href);
}

function loadEnvFile() {
  const dotenvPath = process.env.DOTENV_CONFIG_PATH;

  try {
    if (dotenvPath) {
      process.loadEnvFile(dotenvPath);
      return;
    }

    process.loadEnvFile();
  } catch {
    // Keep parity with dotenv/config startup behavior: missing env files are non-fatal.
  }
}

function resolveSandboxRuntimePackageRoot() {
  const candidateRoots = [
    process.env.FASTAGENT_SANDBOX_RUNTIME_PACKAGE_ROOT,
    deriveGlobalPackageRootFromBinary(),
    deriveGlobalPackageRootFromNpm(),
  ].filter((candidate) => typeof candidate === 'string' && candidate.length > 0);

  for (const candidateRoot of candidateRoots) {
    if (candidateRoot && existsSync(join(candidateRoot, 'dist', 'index.js'))) {
      return resolve(candidateRoot);
    }
  }

  throw new Error('Unable to locate the installed @fastagent/sandbox-runtime package root.');
}

function deriveGlobalPackageRootFromBinary() {
  try {
    const sandboxBinaryPath = realpathSync(
      process.env.FASTAGENT_SANDBOX_RUNTIME_BIN
        ? process.env.FASTAGENT_SANDBOX_RUNTIME_BIN
        : execFileSync('which', ['fastagent-sandbox'], { encoding: 'utf8' }).trim(),
    );

    return resolve(dirname(sandboxBinaryPath), '../lib/node_modules/@fastagent/sandbox-runtime');
  } catch {
    return null;
  }
}

function deriveGlobalPackageRootFromNpm() {
  try {
    const globalNodeModulesRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    return join(globalNodeModulesRoot, '@fastagent', 'sandbox-runtime');
  } catch {
    return null;
  }
}

function appendNodeOption(existingNodeOptions, nextNodeOption) {
  if (!existingNodeOptions || existingNodeOptions.trim().length === 0) {
    return nextNodeOption;
  }

  if (existingNodeOptions.includes(nextNodeOption)) {
    return existingNodeOptions;
  }

  return `${existingNodeOptions} ${nextNodeOption}`;
}
