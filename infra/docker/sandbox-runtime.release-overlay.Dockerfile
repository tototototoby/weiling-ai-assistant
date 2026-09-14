ARG BASE_SANDBOX_IMAGE
FROM ${BASE_SANDBOX_IMAGE}

# Release-only overlay for manager logic changes that do not alter the pinned
# sandbox-runtime package or the image's system/CLI dependency baseline.
COPY infra/sandbox-runtime/srt-pool-manager.mjs /app/infra/sandbox-runtime/srt-pool-manager.mjs
COPY infra/sandbox-runtime/srt-pool-status.mjs /app/infra/sandbox-runtime/srt-pool-status.mjs
