import adapterCloudflare from '@sveltejs/adapter-cloudflare';
import adapterNode from '@sveltejs/adapter-node';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const targetAdapter = process.env.WEBPERF_CONSOLE_ADAPTER === 'node' ? 'node' : 'cloudflare';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter:
      targetAdapter === 'node'
        ? adapterNode({
            out: 'build'
          })
        : adapterCloudflare(),
    alias: {
      '@webperf/contracts': path.resolve(projectDir, '../../packages/contracts/src/index.ts'),
      '@webperf/contracts/*': path.resolve(projectDir, '../../packages/contracts/src/*'),
      '@webperf/domain-core': path.resolve(projectDir, '../../packages/domain-core/src/index.ts'),
      '@webperf/domain-core/*': path.resolve(projectDir, '../../packages/domain-core/src/*'),
      '@webperf/config': path.resolve(projectDir, '../../packages/config/src/index.ts'),
      '@webperf/config/*': path.resolve(projectDir, '../../packages/config/src/*'),
      '@webperf/report-core': path.resolve(projectDir, '../../packages/report-core/src/index.ts'),
      '@webperf/report-core/*': path.resolve(projectDir, '../../packages/report-core/src/*'),
      '@webperf/ui': path.resolve(projectDir, '../../packages/ui/src/index.ts'),
      '@webperf/ui/*': path.resolve(projectDir, '../../packages/ui/src/*')
    }
  }
};

export default config;
