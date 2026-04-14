import { sveltekit } from '@sveltejs/kit/vite';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@webperf/contracts': path.resolve(__dirname, '../../packages/contracts/src/index.ts'),
      '@webperf/domain-core': path.resolve(__dirname, '../../packages/domain-core/src/index.ts'),
      '@webperf/env-schema': path.resolve(__dirname, '../../packages/env-schema/src/index.ts'),
      '@webperf/report-engine': path.resolve(__dirname, '../../packages/report-engine/src/index.ts'),
      '@webperf/ui': path.resolve(__dirname, '../../packages/ui/src/index.ts')
    }
  },
  plugins: [sveltekit()]
});
