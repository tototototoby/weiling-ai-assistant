FROM node:20-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

FROM base AS deps

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/supervisor/package.json apps/supervisor/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY apps/supervisor/scripts/patch-fastagent-cli.mjs apps/supervisor/scripts/patch-fastagent-cli.mjs

RUN node apps/supervisor/scripts/patch-fastagent-cli.mjs

FROM deps AS build

COPY apps/supervisor apps/supervisor
COPY packages/db packages/db
COPY packages/shared packages/shared
COPY resources resources

RUN pnpm --filter @weiling-ai/supervisor build

FROM base AS runtime

ARG LARK_CLI_NPM_VERSION=1.0.32

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gh ffmpeg procps \
  && rm -rf /var/lib/apt/lists/*

RUN npm install --global "@larksuite/cli@${LARK_CLI_NPM_VERSION}" \
  && ln -sf ../lib/node_modules/@larksuite/cli/scripts/run.js /usr/local/bin/lark-cli \
  && lark-cli --version

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=deps /app/tsconfig.base.json ./tsconfig.base.json
COPY apps/supervisor apps/supervisor
COPY --from=deps /app/apps/supervisor/node_modules ./apps/supervisor/node_modules
COPY --from=build /app/apps/supervisor/dist ./apps/supervisor/dist
COPY --from=build /app/resources ./resources
COPY packages/db packages/db
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY packages/shared packages/shared
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules

RUN mkdir -p /app/storage/sqlite /app/storage/instances /app/storage/secrets

CMD ["sh", "-c", "umask 077 && exec node apps/supervisor/dist/index.js"]
