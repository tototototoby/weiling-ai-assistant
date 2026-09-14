ARG BASE_SUPERVISOR_IMAGE
FROM ${BASE_SUPERVISOR_IMAGE} AS build

WORKDIR /app

COPY pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY apps/supervisor ./apps/supervisor
COPY packages/db ./packages/db

RUN pnpm --filter @weiling-ai/supervisor build

FROM ${BASE_SUPERVISOR_IMAGE}

WORKDIR /app

COPY pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY apps/supervisor ./apps/supervisor
COPY packages/db ./packages/db
COPY --from=build /app/apps/supervisor/dist ./apps/supervisor/dist
