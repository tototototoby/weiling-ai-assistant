ARG BASE_SUPERVISOR_IMAGE
FROM ${BASE_SUPERVISOR_IMAGE}

WORKDIR /app

# Keep the deployed dependency/FastAgent patch baseline and rebuild only the
# changed Supervisor bundle from the reviewed source files.
COPY apps/supervisor/scripts/patch-fastagent-cli.mjs /app/apps/supervisor/scripts/patch-fastagent-cli.mjs
COPY apps/supervisor/src/runtime/spawn-fastagent.ts /app/apps/supervisor/src/runtime/spawn-fastagent.ts

RUN node apps/supervisor/scripts/patch-fastagent-cli.mjs \
  --from-v25 \
  --file /app/apps/supervisor/node_modules/@fastagent/cli/cli.js
RUN pnpm --filter @weiling-ai/supervisor build
