import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('docker compose supervisor env wiring', () => {
  it('uses reachable diversified TCP resolvers for both networked runtimes', async () => {
    const overlayPath = fileURLToPath(
      new URL('../../../../infra/compose/docker-compose.network.yml', import.meta.url),
    );
    const overlay = await readFile(overlayPath, 'utf8');

    expect(overlay.match(/- 223\.5\.5\.5/g)).toHaveLength(2);
    expect(overlay.match(/- 119\.29\.29\.29/g)).toHaveLength(2);
    expect(overlay.match(/- 1\.1\.1\.1/g)).toHaveLength(2);
    expect(overlay.match(/- use-vc/g)).toHaveLength(2);
    expect(overlay).not.toContain('192.0.2.1');
  });

  it('passes FASTAGENT_SANDBOX_MODE through to the supervisor container', async () => {
    const composePath = fileURLToPath(
      new URL('../../../../infra/compose/docker-compose.yml', import.meta.url),
    );
    const composeFile = await readFile(composePath, 'utf8');

    expect(composeFile).toContain(
      'FASTAGENT_SANDBOX_MODE: ${FASTAGENT_SANDBOX_MODE:-remote}',
    );
    expect(composeFile).not.toContain('SANDBOX_API_KEY: ${SANDBOX_API_KEY}');
    expect(composeFile).not.toContain('API_KEY: ${SANDBOX_API_KEY}');
  });

  it('keeps the sandbox runtime package version centralized in the Docker version file', async () => {
    const composePath = fileURLToPath(
      new URL('../../../../infra/compose/docker-compose.yml', import.meta.url),
    );
    const envExamplePath = fileURLToPath(
      new URL('../../../../infra/compose/.env.example', import.meta.url),
    );
    const dockerfilePath = fileURLToPath(
      new URL('../../../../infra/docker/sandbox-runtime.Dockerfile', import.meta.url),
    );
    const versionFilePath = fileURLToPath(
      new URL('../../../../infra/docker/sandbox-runtime.versions.env', import.meta.url),
    );

    const [composeFile, envExample, dockerfile, versionFile] = await Promise.all([
      readFile(composePath, 'utf8'),
      readFile(envExamplePath, 'utf8'),
      readFile(dockerfilePath, 'utf8'),
      readFile(versionFilePath, 'utf8'),
    ]);

    expect(versionFile).toContain('SANDBOX_RUNTIME_NPM_VERSION=0.5.7');
    expect(composeFile).toContain(
      'SANDBOX_RUNTIME_NPM_VERSION: ${SANDBOX_RUNTIME_NPM_VERSION:-}',
    );
    expect(composeFile).not.toContain('SANDBOX_RUNTIME_NPM_VERSION:-0.5.7');
    expect(dockerfile).toContain('COPY infra/docker/sandbox-runtime.versions.env');
    expect(dockerfile).toContain('. /tmp/sandbox-runtime.versions.env');
    expect(dockerfile).not.toContain('ARG SANDBOX_RUNTIME_NPM_VERSION=0.5.7');
    expect(envExample).toContain('# SANDBOX_RUNTIME_NPM_VERSION=');
    expect(envExample).not.toContain('# SANDBOX_RUNTIME_NPM_VERSION=0.5.7');
    expect(envExample).not.toContain('SANDBOX_RUNTIME_IMAGE=');
  });

  it('pins the sandbox agent-browser package version through the compose build surface', async () => {
    const composePath = fileURLToPath(
      new URL('../../../../infra/compose/docker-compose.yml', import.meta.url),
    );
    const envExamplePath = fileURLToPath(
      new URL('../../../../infra/compose/.env.example', import.meta.url),
    );

    const [composeFile, envExample] = await Promise.all([
      readFile(composePath, 'utf8'),
      readFile(envExamplePath, 'utf8'),
    ]);

    expect(composeFile).toContain(
      'AGENT_BROWSER_NPM_VERSION: ${AGENT_BROWSER_NPM_VERSION:-0.27.0}',
    );
    expect(envExample).toContain('AGENT_BROWSER_NPM_VERSION=0.27.0');
  });

  it('keeps remote sandbox-runtime image builds aligned with the Dockerfile agent-browser default', async () => {
    const dockerfilePath = fileURLToPath(
      new URL('../../../../infra/docker/sandbox-runtime.Dockerfile', import.meta.url),
    );
    const composePath = fileURLToPath(
      new URL('../../../../infra/compose/docker-compose.yml', import.meta.url),
    );

    const [dockerfile, composeFile] = await Promise.all([
      readFile(dockerfilePath, 'utf8'),
      readFile(composePath, 'utf8'),
    ]);
    const dockerfileVersion = dockerfile.match(/^ARG AGENT_BROWSER_NPM_VERSION=(?<version>\S+)$/m)
      ?.groups?.version;

    expect(dockerfileVersion).toBe('0.27.0');
    expect(composeFile).toContain(
      `AGENT_BROWSER_NPM_VERSION: \${AGENT_BROWSER_NPM_VERSION:-${dockerfileVersion}}`,
    );
  });

  it('keeps remote sandbox-runtime image builds aligned with the Dockerfile lark-cli default', async () => {
    const dockerfilePath = fileURLToPath(
      new URL('../../../../infra/docker/sandbox-runtime.Dockerfile', import.meta.url),
    );
    const composePath = fileURLToPath(
      new URL('../../../../infra/compose/docker-compose.yml', import.meta.url),
    );

    const [dockerfile, composeFile] = await Promise.all([
      readFile(dockerfilePath, 'utf8'),
      readFile(composePath, 'utf8'),
    ]);
    const dockerfileVersion = dockerfile.match(/^ARG LARK_CLI_NPM_VERSION=(?<version>\S+)$/m)
      ?.groups?.version;

    expect(dockerfileVersion).toBe('1.0.32');
    expect(composeFile.match(/LARK_CLI_NPM_VERSION: \${LARK_CLI_NPM_VERSION:-1\.0\.32}/g))
      .toHaveLength(2);
  });

  it('pins bun and uv versions through the sandbox compose build surface', async () => {
    const composePath = fileURLToPath(
      new URL('../../../../infra/compose/docker-compose.yml', import.meta.url),
    );
    const envExamplePath = fileURLToPath(
      new URL('../../../../infra/compose/.env.example', import.meta.url),
    );

    const [composeFile, envExample] = await Promise.all([
      readFile(composePath, 'utf8'),
      readFile(envExamplePath, 'utf8'),
    ]);

    expect(composeFile).toContain(
      'BUN_VERSION: ${BUN_VERSION:-1.3.13}',
    );
    expect(composeFile).toContain(
      'UV_VERSION: ${UV_VERSION:-0.11.7}',
    );
    expect(envExample).toContain('BUN_VERSION=1.3.13');
    expect(envExample).toContain('UV_VERSION=0.11.7');
  });

  it('pins pnpm version through the sandbox compose build surface', async () => {
    const composePath = fileURLToPath(
      new URL('../../../../infra/compose/docker-compose.yml', import.meta.url),
    );
    const envExamplePath = fileURLToPath(
      new URL('../../../../infra/compose/.env.example', import.meta.url),
    );

    const [composeFile, envExample] = await Promise.all([
      readFile(composePath, 'utf8'),
      readFile(envExamplePath, 'utf8'),
    ]);

    expect(composeFile).toContain(
      'PNPM_VERSION: ${PNPM_VERSION:-9.15.4}',
    );
    expect(envExample).toContain('PNPM_VERSION=9.15.4');
  });

  it('keeps optional compose env overrides commented by default in the example file', async () => {
    const envExamplePath = fileURLToPath(
      new URL('../../../../infra/compose/.env.example', import.meta.url),
    );
    const envExample = await readFile(envExamplePath, 'utf8');

    expect(envExample).toContain('# COMPOSE_PROJECT_NAME=weiling-ai-assistant');
    expect(envExample).toContain('# WEILING_DATA_ROOT=/srv/weiling/data');
    expect(envExample).toContain('# WEB_ADMIN_EMAILS=admin@example.com');
    expect(envExample).toContain('# WEB_USER_BOT_LIMIT=0');
    expect(envExample).toContain('# SANDBOX_RUNTIME_NPM_VERSION=');
    expect(envExample).toContain('# SRT_DEFAULT_POOL_SIZE=1');
    expect(envExample).toContain('# SRT_DEFAULT_MIN_READY_PROCESSES=1');
    expect(envExample).toContain('# SRT_PORT_BASE=31000');
    expect(envExample).toContain('# SRT_PROXY_PORT_BASE=9100');
    expect(envExample).not.toContain('SANDBOX_API_KEY=replace-me');
    expect(envExample).not.toContain('# SANDBOX_POOL_SIZE=10');
    expect(envExample).not.toContain('FASTAGENT_DEFAULT_PROVIDER=');
    expect(envExample).not.toContain('FASTAGENT_DEFAULT_MODEL=');
    expect(envExample).not.toContain('FASTAGENT_API_KEY=');
    expect(envExample).not.toContain('FASTAGENT_BASE_URL=');
    expect(envExample).not.toContain('FASTAGENT_API_TYPE=');
  });

  it('keeps the user sandbox runtime pool defaults aligned with the documented compose baseline', async () => {
    const composePath = fileURLToPath(
      new URL('../../../../infra/compose/docker-compose.yml', import.meta.url),
    );
    const envExamplePath = fileURLToPath(
      new URL('../../../../infra/compose/.env.example', import.meta.url),
    );

    const [composeFile, envExample] = await Promise.all([
      readFile(composePath, 'utf8'),
      readFile(envExamplePath, 'utf8'),
    ]);

    expect(composeFile).toContain('SRT_DEFAULT_POOL_SIZE: ${SRT_DEFAULT_POOL_SIZE:-1}');
    expect(composeFile).toContain('SRT_DEFAULT_MIN_READY_PROCESSES: ${SRT_DEFAULT_MIN_READY_PROCESSES:-1}');
    expect(composeFile).toContain(
      'SRT_DEFAULT_SESSION_TIMEOUT_MS: ${SRT_DEFAULT_SESSION_TIMEOUT_MS:-600000}',
    );
    expect(composeFile).toContain('SRT_PORT_BASE: ${SRT_PORT_BASE:-31000}');
    expect(composeFile).toContain('SRT_PROXY_PORT_BASE: ${SRT_PROXY_PORT_BASE:-9100}');
    expect(envExample).toContain('SRT_DEFAULT_POOL_SIZE=1');
    expect(envExample).toContain('SRT_DEFAULT_SESSION_TIMEOUT_MS=600000');
  });

  it('wires the user sandbox runtime network policy through the SRT default env surface', async () => {
    const composePath = fileURLToPath(
      new URL('../../../../infra/compose/docker-compose.yml', import.meta.url),
    );
    const envExamplePath = fileURLToPath(
      new URL('../../../../infra/compose/.env.example', import.meta.url),
    );

    const [composeFile, envExample] = await Promise.all([
      readFile(composePath, 'utf8'),
      readFile(envExamplePath, 'utf8'),
    ]);

    expect(composeFile).toContain(
      'SRT_DEFAULT_DENIED_DOMAINS: ${SRT_DEFAULT_DENIED_DOMAINS:-}',
    );
    expect(composeFile).not.toContain('SANDBOX_DEFAULT_ALLOWED_DOMAINS');
    expect(envExample).toContain('SRT_DEFAULT_DENIED_DOMAINS=');
    expect(envExample).not.toContain('SANDBOX_DEFAULT_ALLOWED_DOMAINS');
  });

  it('runs the repo-local sandbox pool manager with private config and Bot-scoped workspaces', async () => {
    const composePath = fileURLToPath(
      new URL('../../../../infra/compose/docker-compose.yml', import.meta.url),
    );
    const dockerfilePath = fileURLToPath(
      new URL('../../../../infra/docker/sandbox-runtime.Dockerfile', import.meta.url),
    );
    const externalOverridePath = fileURLToPath(
      new URL('../../../../infra/compose/docker-compose.external-sandbox.yml', import.meta.url),
    );

    const [composeFile, dockerfile] = await Promise.all([
      readFile(composePath, 'utf8'),
      readFile(dockerfilePath, 'utf8'),
    ]);

    expect(composeFile).toContain(
      'SRT_POOL_CONFIG_FILE: /app/storage/sandbox-runtime-private/srt-pools.json',
    );
    expect(composeFile).toContain(
      'SRT_POOL_STATUS_FILE: /app/storage/sandbox-runtime-private/srt-pool-status.json',
    );
    expect(composeFile).toContain('SRT_MANAGER_PORT: ${SANDBOX_RUNTIME_PORT:-8788}');
    expect(composeFile).toContain('- weiling_instances:/app/storage/instances');
    expect(composeFile).toContain('- weiling_sandbox_user_workspaces:/app/apps/sandbox-runtime/user-workspaces');
    expect(composeFile).toContain('- weiling_sandbox_runtime_private:/app/storage/sandbox-runtime-private');
    expect(dockerfile).toContain('COPY infra/sandbox-runtime /app/infra/sandbox-runtime');
    expect(dockerfile).toContain('CMD ["node", "/app/infra/sandbox-runtime/entry.mjs"]');
    await expect(access(externalOverridePath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('keeps the sandbox runtime security profile aligned with the bubblewrap baseline', async () => {
    const composePath = fileURLToPath(
      new URL('../../../../infra/compose/docker-compose.yml', import.meta.url),
    );
    const composeFile = await readFile(composePath, 'utf8');

    expect(composeFile).toContain('cap_drop:');
    expect(composeFile).toContain('- ALL');
    expect(composeFile).toContain('cap_add:');
    expect(composeFile).toContain('- SYS_ADMIN');
    expect(composeFile).toContain('- NET_ADMIN');
    expect(composeFile).toContain('cgroup: private');
    expect(composeFile).toContain('security_opt:');
    expect(composeFile).toContain('- seccomp=unconfined');
    expect(composeFile).toContain('- apparmor=unconfined');
  });

  it('defines a production compose override that pulls the published GHCR images', async () => {
    const prodComposePath = fileURLToPath(
      new URL('../../../../infra/compose/docker-compose.prod.yml', import.meta.url),
    );
    const envExamplePath = fileURLToPath(
      new URL('../../../../infra/compose/.env.example', import.meta.url),
    );
    const [prodComposeFile, envExample] = await Promise.all([
      readFile(prodComposePath, 'utf8'),
      readFile(envExamplePath, 'utf8'),
    ]);

    expect(prodComposeFile).toContain(
      'image: ${WEILING_IMAGE_REGISTRY:-${WECLAWS_IMAGE_REGISTRY:?Set WEILING_IMAGE_REGISTRY before using the published-image override}}/sandbox-runtime:${WEILING_IMAGE_TAG:-${WECLAWS_IMAGE_TAG:-0.2.0-beta.1}}',
    );
    expect(prodComposeFile).toContain(
      'image: ghcr.io/browserless/chromium:v2.56.7@sha256:b1ba7b054af2891a8199f884d4bd249cf8c3bd2fa8a97b339077e40f92803ba8',
    );
    expect(prodComposeFile).toContain('profiles:\n      - browserless');
    expect(prodComposeFile).toContain(
      'image: ${WEILING_IMAGE_REGISTRY:-${WECLAWS_IMAGE_REGISTRY:?Set WEILING_IMAGE_REGISTRY before using the published-image override}}/supervisor:${WEILING_IMAGE_TAG:-${WECLAWS_IMAGE_TAG:-0.2.0-beta.1}}',
    );
    expect(prodComposeFile).toContain('image: ${WEILING_IMAGE_REGISTRY:-${WECLAWS_IMAGE_REGISTRY:?Set WEILING_IMAGE_REGISTRY before using the published-image override}}/web:${WEILING_IMAGE_TAG:-${WECLAWS_IMAGE_TAG:-0.2.0-beta.1}}');
    expect(prodComposeFile).toContain('build: !reset null');
    expect(prodComposeFile).toContain('pull_policy: always');
    expect(prodComposeFile).toContain('${WEILING_DATA_ROOT:-${WECLAWS_DATA_ROOT:-/srv/weiling/data}}/sqlite:/app/storage/sqlite');
    expect(prodComposeFile).toContain(
      '${WEILING_DATA_ROOT:-${WECLAWS_DATA_ROOT:-/srv/weiling/data}}/instances:/app/storage/instances',
    );
    expect(prodComposeFile).toContain(
      '${WEILING_DATA_ROOT:-${WECLAWS_DATA_ROOT:-/srv/weiling/data}}/sandbox-user-workspaces:/app/apps/sandbox-runtime/user-workspaces',
    );
    expect(prodComposeFile).toContain(
      '${WEILING_DATA_ROOT:-${WECLAWS_DATA_ROOT:-/srv/weiling/data}}/sandbox-runtime-private:/app/storage/sandbox-runtime-private',
    );
    expect(
      prodComposeFile.match(/sandbox-runtime-private:\/app\/storage\/sandbox-runtime-private/g),
    ).toHaveLength(3);
    expect(prodComposeFile).toContain(
      '${WEILING_DATA_ROOT:-${WECLAWS_DATA_ROOT:-/srv/weiling/data}}/secrets:/app/storage/secrets:ro',
    );
    expect(prodComposeFile).toContain(
      '${WEILING_DATA_ROOT:-${WECLAWS_DATA_ROOT:-/srv/weiling/data}}/secrets:/app/storage/secrets',
    );
    expect(envExample).toContain('WEILING_DATA_ROOT=');
  });

  it('preinstalls the expanded CLI baseline in the sandbox image', async () => {
    const dockerfilePath = fileURLToPath(
      new URL('../../../../infra/docker/sandbox-runtime.Dockerfile', import.meta.url),
    );
    const composePath = fileURLToPath(
      new URL('../../../../infra/compose/docker-compose.yml', import.meta.url),
    );
    const envExamplePath = fileURLToPath(
      new URL('../../../../infra/compose/.env.example', import.meta.url),
    );
    const [composeFile, dockerfile, envExample] = await Promise.all([
      readFile(composePath, 'utf8'),
      readFile(dockerfilePath, 'utf8'),
      readFile(envExamplePath, 'utf8'),
    ]);

    expect(dockerfile).toContain('ARG AGENT_BROWSER_NPM_VERSION=0.27.0');
    expect(dockerfile).toContain('ARG BUN_VERSION=1.3.13');
    expect(dockerfile).toContain('ARG LARK_CLI_NPM_VERSION=1.0.32');
    expect(dockerfile).toContain('ARG PNPM_VERSION=9.15.4');
    expect(dockerfile).toContain('ARG UV_VERSION=0.11.7');
    expect(dockerfile).toContain('ffmpeg');
    expect(dockerfile).toContain('file');
    expect(dockerfile).toContain('jq');
    expect(dockerfile).toContain('pandoc');
    expect(dockerfile).toContain('poppler-utils');
    expect(dockerfile).toContain('rm -f /etc/passwd- /etc/shadow- /etc/group- /etc/gshadow-');
    expect(dockerfile).toContain('unzip');
    expect(dockerfile).toContain('zip');
    expect(dockerfile).toContain('npm install -g agent-browser@${AGENT_BROWSER_NPM_VERSION}');
    expect(dockerfile).toContain('npm install -g "@larksuite/cli@${LARK_CLI_NPM_VERSION}"');
    expect(dockerfile).not.toContain('agent-browser install --with-deps');
    expect(dockerfile).not.toContain('chromium');
    expect(dockerfile).not.toContain('AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium');
    expect(dockerfile).toContain('ENV PATH="/usr/local/bin:${PATH}"');
    expect(dockerfile).toContain('ENV SANDBOX_COMMAND_EXTRA_PATHS="/usr/local/bin"');
    expect(dockerfile).toContain(
      'amd64) bun_target="linux-x64-baseline" ;;',
    );
    expect(dockerfile).toContain(
      'arm64) bun_target="linux-aarch64" ;;',
    );
    expect(dockerfile).toContain(
      'https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-${bun_target}.zip',
    );
    expect(dockerfile).not.toContain('/root/.bun/bin');
    expect(dockerfile).toContain('npm install -g pnpm@${PNPM_VERSION}');
    expect(dockerfile).toContain(
      'curl -LsSf https://astral.sh/uv/${UV_VERSION}/install.sh | env UV_UNMANAGED_INSTALL="/usr/local/bin" sh',
    );
    expect(dockerfile).toContain('lark-cli --version');
    expect(composeFile).toContain('LARK_CLI_NPM_VERSION: ${LARK_CLI_NPM_VERSION:-1.0.32}');
    expect(envExample).toContain('# LARK_CLI_NPM_VERSION=1.0.32');
    expect(composeFile).toContain('SANDBOX_COMMAND_EXTRA_PATHS: ${SANDBOX_COMMAND_EXTRA_PATHS:-/usr/local/bin}');
    expect(envExample).toContain('# SANDBOX_COMMAND_EXTRA_PATHS=/usr/local/bin');
  });

  it('passes web runtime env and SRT admin status config into the web container', async () => {
    const composePath = fileURLToPath(
      new URL('../../../../infra/compose/docker-compose.yml', import.meta.url),
    );
    const composeFile = await readFile(composePath, 'utf8');

    expect(composeFile).toContain('WEB_ADMIN_EMAILS: ${WEB_ADMIN_EMAILS:-}');
    expect(composeFile).toContain('SRT_POOL_STATUS_FILE: /app/storage/sandbox-runtime-private/srt-pool-status.json');
    expect(composeFile).toContain('- weiling_sandbox_runtime_private:/app/storage/sandbox-runtime-private');
    expect(composeFile).not.toContain('FASTAGENT_DEFAULT_PROVIDER: ${FASTAGENT_DEFAULT_PROVIDER:-}');
    expect(composeFile).not.toContain('FASTAGENT_DEFAULT_MODEL: ${FASTAGENT_DEFAULT_MODEL:-}');
    expect(composeFile).not.toContain('FASTAGENT_API_KEY: ${FASTAGENT_API_KEY:-}');
    expect(composeFile).not.toContain('FASTAGENT_BASE_URL: ${FASTAGENT_BASE_URL:-}');
    expect(composeFile).not.toContain('FASTAGENT_API_TYPE: ${FASTAGENT_API_TYPE:-}');
  });

  it('shares the persistent SMTP secret with web as read-write and supervisor as read-only', async () => {
    const composePath = fileURLToPath(
      new URL('../../../../infra/compose/docker-compose.yml', import.meta.url),
    );
    const webDockerfilePath = fileURLToPath(
      new URL('../../../../infra/docker/web.Dockerfile', import.meta.url),
    );
    const supervisorDockerfilePath = fileURLToPath(
      new URL('../../../../infra/docker/supervisor.Dockerfile', import.meta.url),
    );
    const gitignorePath = fileURLToPath(new URL('../../../../.gitignore', import.meta.url));
    const dockerignorePath = fileURLToPath(new URL('../../../../.dockerignore', import.meta.url));
    const [composeFile, webDockerfile, supervisorDockerfile, gitignore, dockerignore] = await Promise.all([
      readFile(composePath, 'utf8'),
      readFile(webDockerfilePath, 'utf8'),
      readFile(supervisorDockerfilePath, 'utf8'),
      readFile(gitignorePath, 'utf8'),
      readFile(dockerignorePath, 'utf8'),
    ]);

    expect(composeFile).toContain('- weiling_secrets:/app/storage/secrets:ro');
    expect(composeFile).toContain('- weiling_secrets:/app/storage/secrets');
    expect(composeFile.match(/weiling_secrets:\/app\/storage\/secrets/g)).toHaveLength(2);
    expect(composeFile).toMatch(/volumes:\s+[\s\S]*weiling_secrets:/);
    expect(webDockerfile).toContain('/app/storage/secrets');
    expect(supervisorDockerfile).toContain('/app/storage/secrets');
    expect(gitignore).toContain('storage/**');
    expect(dockerignore).toContain('storage/**');
    expect(dockerignore).toContain('!storage/instances/.gitkeep');
  });

  it('defines a browserless sidecar contract for remote browser automation', async () => {
    const composePath = fileURLToPath(
      new URL('../../../../infra/compose/docker-compose.yml', import.meta.url),
    );
    const prodComposePath = fileURLToPath(
      new URL('../../../../infra/compose/docker-compose.prod.yml', import.meta.url),
    );
    const envExamplePath = fileURLToPath(
      new URL('../../../../infra/compose/.env.example', import.meta.url),
    );

    const [composeFile, prodComposeFile, envExample] = await Promise.all([
      readFile(composePath, 'utf8'),
      readFile(prodComposePath, 'utf8'),
      readFile(envExamplePath, 'utf8'),
    ]);

    expect(composeFile).toContain('browserless:');
    expect(composeFile).toContain('profiles:\n      - browserless');
    expect(composeFile).toContain(
      'image: ghcr.io/browserless/chromium:v2.56.7@sha256:b1ba7b054af2891a8199f884d4bd249cf8c3bd2fa8a97b339077e40f92803ba8',
    );
    expect(composeFile).not.toContain('SANDBOX_RUNTIME_PORT:-8788}:');
    expect(composeFile).not.toContain('- "${BROWSERLESS_PORT:-3000}:3000"');
    expect(composeFile).toContain('TOKEN: ${BROWSERLESS_TOKEN}');
    expect(composeFile).toContain('CONCURRENT: ${BROWSERLESS_CONCURRENT:-2}');
    expect(composeFile).toContain('QUEUED: ${BROWSERLESS_QUEUED:-2}');
    expect(composeFile).toContain('TIMEOUT: ${BROWSERLESS_TIMEOUT:-120000}');
    expect(composeFile).toContain(
      'BROWSERLESS_API_URL: ${BROWSERLESS_API_URL:-http://browserless:3000}',
    );
    expect(composeFile).toContain('BROWSERLESS_API_KEY: ${BROWSERLESS_TOKEN}');
    expect(prodComposeFile).toContain('browserless:');
    expect(prodComposeFile).toContain('image: ghcr.io/browserless/chromium:v2.56.7@sha256:b1ba7b054af2891a8199f884d4bd249cf8c3bd2fa8a97b339077e40f92803ba8');
    expect(prodComposeFile).toContain('pull_policy: missing');
    expect(prodComposeFile).toContain('profiles:\n      - browserless');
    expect(envExample).toContain('BROWSERLESS_TOKEN=replace-me');
    expect(envExample).not.toContain('# BROWSERLESS_TOKEN=replace-me');
    expect(envExample).toContain('# BROWSERLESS_API_URL=http://browserless:3000');
    expect(envExample).toContain('# BROWSERLESS_CONCURRENT=2');
    expect(envExample).toContain('# BROWSERLESS_QUEUED=2');
    expect(envExample).toContain('# BROWSERLESS_TIMEOUT=120000');
  });

  it('runs supervisor from compiled output in the Docker image', async () => {
    const dockerfilePath = fileURLToPath(
      new URL('../../../../infra/docker/supervisor.Dockerfile', import.meta.url),
    );
    const buildScriptPath = fileURLToPath(
      new URL('../../scripts/build.mjs', import.meta.url),
    );
    const [dockerfile, buildScript] = await Promise.all([
      readFile(dockerfilePath, 'utf8'),
      readFile(buildScriptPath, 'utf8'),
    ]);

    expect(dockerfile).toContain('COPY resources resources');
    expect(dockerfile).toContain('COPY --from=build /app/resources ./resources');
    expect(dockerfile).toContain('RUN pnpm --filter @weiling-ai/supervisor build');
    expect(dockerfile).toContain('ARG LARK_CLI_NPM_VERSION=1.0.32');
    expect(dockerfile).toContain('npm install --global "@larksuite/cli@${LARK_CLI_NPM_VERSION}"');
    expect(dockerfile).not.toContain('COPY --from=ghcr.io/');
    expect(dockerfile).toContain(
      'CMD ["sh", "-c", "umask 077 && exec node apps/supervisor/dist/index.js"]',
    );
    expect(dockerfile).not.toContain('exec", "tsx", "src/index.ts');
    expect(buildScript).toContain(
      "external: ['better-sqlite3', '@wecom/aibot-node-sdk', 'nodemailer']",
    );
  });

  it('keeps the web runtime image capable of running managed-skills locks and version lookup', async () => {
    const dockerfilePath = fileURLToPath(
      new URL('../../../../infra/docker/web.Dockerfile', import.meta.url),
    );
    const dockerfile = await readFile(dockerfilePath, 'utf8');

    expect(dockerfile).toContain('apt-get install -y --no-install-recommends procps');
    expect(dockerfile).toContain('COPY apps/supervisor/package.json apps/supervisor/package.json');
    expect(dockerfile).toContain(
      'COPY --from=build /repo/apps/supervisor/package.json ./apps/supervisor/package.json',
    );
    expect(dockerfile).toContain('COPY resources resources');
    expect(dockerfile).toContain('COPY --from=build /repo/resources ./resources');
    expect(dockerfile).toContain('COPY --from=build /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml');
  });

  it('keeps the repo-local fastagent cli version aligned across package metadata and docs', async () => {
    const packageJsonPath = fileURLToPath(
      new URL('../../package.json', import.meta.url),
    );
    const lockfilePath = fileURLToPath(
      new URL('../../../../pnpm-lock.yaml', import.meta.url),
    );
    const thirdPartyNoticesPath = fileURLToPath(
      new URL('../../../../THIRD_PARTY_NOTICES.md', import.meta.url),
    );

    const [packageJson, lockfile, thirdPartyNotices] =
      await Promise.all([
        readFile(packageJsonPath, 'utf8'),
        readFile(lockfilePath, 'utf8'),
        readFile(thirdPartyNoticesPath, 'utf8'),
      ]);

    const fastagentCliVersion = (
      JSON.parse(packageJson) as {
        dependencies?: Record<string, string>;
      }
    ).dependencies?.['@fastagent/cli'];

    expect(fastagentCliVersion).toBeTruthy();
    expect(lockfile).toContain(`specifier: ${fastagentCliVersion}`);
    expect(lockfile).toContain(`@fastagent/cli@${fastagentCliVersion}`);
    expect(thirdPartyNotices).toContain(`@fastagent/cli@${fastagentCliVersion}`);
  });

  it('keeps the official WeCom SDK version aligned across package metadata and docs', async () => {
    const packageJsonPath = fileURLToPath(
      new URL('../../package.json', import.meta.url),
    );
    const lockfilePath = fileURLToPath(
      new URL('../../../../pnpm-lock.yaml', import.meta.url),
    );
    const thirdPartyNoticesPath = fileURLToPath(
      new URL('../../../../THIRD_PARTY_NOTICES.md', import.meta.url),
    );

    const [packageJson, lockfile, thirdPartyNotices] = await Promise.all([
      readFile(packageJsonPath, 'utf8'),
      readFile(lockfilePath, 'utf8'),
      readFile(thirdPartyNoticesPath, 'utf8'),
    ]);
    const sdkVersion = (
      JSON.parse(packageJson) as { dependencies?: Record<string, string> }
    ).dependencies?.['@wecom/aibot-node-sdk'];

    expect(sdkVersion).toBeTruthy();
    expect(lockfile).toContain(`specifier: ${sdkVersion}`);
    expect(lockfile).toContain(`@wecom/aibot-node-sdk@${sdkVersion}`);
    expect(thirdPartyNotices).toContain(`@wecom/aibot-node-sdk@${sdkVersion}`);
  });

  it('preinstalls managed-skill runtime tools in the supervisor image', async () => {
    const dockerfilePath = fileURLToPath(
      new URL('../../../../infra/docker/supervisor.Dockerfile', import.meta.url),
    );
    const dockerfile = await readFile(dockerfilePath, 'utf8');

    expect(dockerfile).toContain(
      'apt-get install -y --no-install-recommends ca-certificates curl gh ffmpeg procps',
    );
  });
});
