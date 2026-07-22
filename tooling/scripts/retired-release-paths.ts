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
  }
] as const;
