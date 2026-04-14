# webperf-selfhosted

Self-hosted global release verification with manual checks, scheduled runs, and baseline diffing.

This repository ships the self-hosted edition of Webperf and Guide:

- `apps/console`: SvelteKit UI for configuring checks and reviewing runs
- `apps/control`: Bun + SQLite control service for saved config, run dispatch, history, comparisons, and reports
- `apps/probe-rs`: Rust probe runtime
- `packages/contracts`, `packages/domain-core`, `packages/env-schema`, `packages/report-engine`, `packages/ui`
- `infra/compose`: Docker Compose bundle
- `infra/docker`: probe image metadata

## Local Development

```bash
bun install
bun run dev
```

Default local URLs:

- console: `http://localhost:5173`
- control: `http://127.0.0.1:8788`
- probe: `http://127.0.0.1:8080`

## Useful Commands

```bash
bun run check
bun test apps/control/test
bun run test:report-engine
bun run compose:config
```

## Compose Bundle

Compose assets live in [infra/compose/docker-compose.yml](infra/compose/docker-compose.yml).

Install and scheduling notes live in:

- [docs/install.md](docs/install.md)
- [docs/examples/github-actions-scheduler.yml](docs/examples/github-actions-scheduler.yml)

## Release Tooling

This repo uses Sampo for release metadata.

```bash
bun run sampo:add
bun run sampo:release:dry-run
bun run sampo:release
bun run sampo:publish
```

Pending release notes live under `.sampo/changesets/`.
