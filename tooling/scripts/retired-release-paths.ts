export const retiredReleasePaths = [
  {
    path: '.github/workflows/publish-probe-image.yml',
    message: 'use the gated ci.yml development publisher and release.yml instead'
  },
  {
    path: '.github/workflows/publish-browser-audit-image.yml',
    message: 'use the gated ci.yml development publisher and release.yml instead'
  },
  {
    path: 'infra/docker/metadata/probe.json',
    message: 'consume digest-bearing GitHub Release runtime metadata instead'
  },
  {
    path: 'infra/docker/metadata/browser-audit-lighthouse.json',
    message: 'consume digest-bearing GitHub Release runtime metadata instead'
  },
  {
    path: 'tooling/scripts/bump-image-tag.ts',
    message: 'release image identity is generated from immutable digests now'
  },
  {
    path: 'infra/regional-runtime',
    message: 'managed orchestration consumes the stateless probe image directly'
  },
  {
    path: 'apps/api/src/regional-runtime-record.ts',
    message: 'keep managed orchestration outside the self-hosted API'
  },
  {
    path: 'packages/contracts/src/regional-runtime.ts',
    message: 'consume the stateless probe contract instead'
  },
  {
    path: 'packages/contracts/src/regional-runtime-contract.ts',
    message: 'consume the stateless probe contract instead'
  },
  {
    path: 'packages/contracts/src/regional-runtime-openapi.ts',
    message: 'consume the stateless probe contract instead'
  },
  {
    path: 'tooling/scripts/check-regional-runtime.ts',
    message: 'validate the standalone self-host and stateless probe surfaces instead'
  },
  {
    path: 'tooling/scripts/smoke-regional-runtime.sh',
    message: 'use the standalone Compose and Bunny-like probe smoke tests instead'
  },
  {
    path: 'tooling/scripts/smoke-regional-runtime.ts',
    message: 'use the standalone Compose and Bunny-like probe smoke tests instead'
  }
] as const;
