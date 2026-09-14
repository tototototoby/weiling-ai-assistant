import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@weiling-ai/db': fileURLToPath(
        new URL('../../packages/db/src/index.ts', import.meta.url),
      ),
      '@weiling-ai/shared/managed-skills': fileURLToPath(
        new URL('../../packages/shared/src/managed-skills/index.ts', import.meta.url),
      ),
      '@weiling-ai/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
});
