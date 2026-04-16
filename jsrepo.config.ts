import { defineConfig } from 'jsrepo';

export default defineConfig({
  registries: ['@ieedan/shadcn-svelte-extras'],
  paths: {
    ui: 'packages/ui/src/lib/components/ui',
    component: 'packages/ui/src/lib/components',
    block: 'packages/ui/src/lib/components',
    hook: 'packages/ui/src/lib/hooks',
    action: 'packages/ui/src/lib/actions',
    util: 'packages/ui/src/lib',
    lib: 'packages/ui/src/lib'
  }
});
