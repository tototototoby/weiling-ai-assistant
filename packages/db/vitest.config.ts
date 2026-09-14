import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@weiling-ai/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
});
