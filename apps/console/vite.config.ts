import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  ssr: {
    noExternal: ['@lucide/svelte', '@internationalized/date', 'bits-ui', 'runed', 'svelte-toolbelt', 'tailwind-variants']
  },
  resolve: {
    alias: {
      '@webperf/contracts': path.resolve(__dirname, '../../packages/contracts/src/index.ts'),
      '@webperf/domain-core': path.resolve(__dirname, '../../packages/domain-core/src/index.ts'),
      '@webperf/config': path.resolve(__dirname, '../../packages/config/src/index.ts'),
      '@webperf/report-core': path.resolve(__dirname, '../../packages/report-core/src/index.ts'),
      '@webperf/ui/components': path.resolve(__dirname, '../../packages/ui/src/lib/components'),
      '@webperf/ui/styles': path.resolve(__dirname, '../../packages/ui/src/styles'),
      '@webperf/ui/utils': path.resolve(__dirname, '../../packages/ui/src/lib/utils.ts'),
      '@webperf/ui': path.resolve(__dirname, '../../packages/ui/src')
    }
  },
  plugins: [tailwindcss(), sveltekit()]
});
