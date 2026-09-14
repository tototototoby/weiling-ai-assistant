FROM node:26-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

FROM base AS deps

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/supervisor/package.json apps/supervisor/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

FROM deps AS build

COPY apps/web apps/web
COPY packages/db packages/db
COPY packages/shared packages/shared
COPY resources resources

RUN pnpm --filter @weiling-ai/web build

FROM node:26-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN apt-get update \
  && apt-get install -y --no-install-recommends procps \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
COPY --from=build /repo/apps/supervisor/package.json ./apps/supervisor/package.json
COPY --from=build /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /repo/resources ./resources

RUN mkdir -p /app/storage/sqlite /app/storage/instances /app/storage/secrets

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/login', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

CMD ["sh", "-c", "umask 077 && exec node apps/web/server.js"]
