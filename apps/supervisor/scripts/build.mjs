import { cpSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const CURRENT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SUPERVISOR_ROOT = path.resolve(CURRENT_DIRECTORY, '..');
const REPO_ROOT = path.resolve(SUPERVISOR_ROOT, '..', '..');
const DIST_DIRECTORY = path.join(SUPERVISOR_ROOT, 'dist');
const ENTRY_FILES = {
  index: path.join(SUPERVISOR_ROOT, 'src', 'index.ts'),
  'dify-mcp-server': path.join(SUPERVISOR_ROOT, 'src', 'dify-mcp-server.ts'),
};
const MIGRATIONS_SOURCE_DIRECTORY = path.join(REPO_ROOT, 'packages', 'db', 'src', 'migrations');
const MIGRATIONS_DESTINATION_DIRECTORY = path.join(DIST_DIRECTORY, 'migrations');

rmSync(DIST_DIRECTORY, { force: true, recursive: true });

await build({
  bundle: true,
  entryPoints: ENTRY_FILES,
  external: ['better-sqlite3', '@wecom/aibot-node-sdk', 'nodemailer'],
  format: 'esm',
  logLevel: 'info',
  outdir: DIST_DIRECTORY,
  packages: 'bundle',
  platform: 'node',
  target: 'node20',
  tsconfig: path.join(SUPERVISOR_ROOT, 'tsconfig.json'),
});

mkdirSync(MIGRATIONS_DESTINATION_DIRECTORY, { recursive: true });
cpSync(MIGRATIONS_SOURCE_DIRECTORY, MIGRATIONS_DESTINATION_DIRECTORY, { recursive: true });
