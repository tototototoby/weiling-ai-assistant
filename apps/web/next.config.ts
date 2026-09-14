import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const appRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(appRoot, '../..'),
  transpilePackages: ['@weiling-ai/db', '@weiling-ai/shared'],
};

export default nextConfig;
