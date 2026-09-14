ARG BASE_SANDBOX_IMAGE
FROM ${BASE_SANDBOX_IMAGE}

COPY infra/sandbox-runtime /app/infra/sandbox-runtime

CMD ["node", "/app/infra/sandbox-runtime/entry.mjs"]
