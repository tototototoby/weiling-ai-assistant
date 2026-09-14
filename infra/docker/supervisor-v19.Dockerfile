ARG BASE_SUPERVISOR_IMAGE
FROM ${BASE_SUPERVISOR_IMAGE} AS build

WORKDIR /app

COPY pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY apps/supervisor ./apps/supervisor
COPY infra/sandbox-runtime ./infra/sandbox-runtime
COPY packages/db ./packages/db

RUN pnpm --filter @weiling-ai/supervisor build

FROM ${BASE_SUPERVISOR_IMAGE}

WORKDIR /app

COPY pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY apps/supervisor ./apps/supervisor
COPY infra/sandbox-runtime ./infra/sandbox-runtime
COPY packages/db ./packages/db
COPY resources ./resources
COPY --from=build /app/apps/supervisor/dist ./apps/supervisor/dist

RUN node -e "const fs=require('fs');const path=require('path');const f=path.join(path.dirname(require.resolve('@fastagent/cli/package.json',{paths:['/app/apps/supervisor']})),'cli.js');const s=fs.readFileSync(f,'utf8');const a='收到，我正在处理，完成后把结果发给你。';const b='收到，我是微Link，正在处理，完成后把结果发给你。';const n=s.split(a).length-1;if(n!==1)throw new Error('Expected one legacy visible acknowledgement, found '+n);fs.writeFileSync(f,s.replace(a,b));"
