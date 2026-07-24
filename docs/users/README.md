# WebPerf self-hosted user guides

These guides follow the lifecycle of a small, trusted single-organization
installation.

## Install and operate

1. [Install](./install.md) a tagged, digest-pinned release bundle.
2. [Configure](./configure.md) secrets, storage, network origins, and limits.
3. Connect [Regions](./regions.md) to real probe runtimes.
4. Build reusable [Checks](./checks.md).
5. Enable and observe [Scheduling](./scheduling.md).
6. Optionally enable [Browser Audits](./browser-audits.md) and manage
   [Artifacts](./artifacts.md).

## Protect and maintain

- [Security model](./security.md)
- [Reverse proxy and remote access](./reverse-proxy.md)
- [Backup and restore](./backup-restore.md)
- [Upgrade](./upgrade.md)
- [Troubleshooting](./troubleshooting.md)
- [Self-hosted vs WebPerf Cloud](./cloud-vs-self-hosted.md)

The frozen [public API surface](../architecture/public-api-surface.md) is the
integration reference. Contributor setup lives separately under
[docs/contributors](../contributors/development.md).
