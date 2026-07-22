# Contributing

This repo is the self-hosted/open-core edition of `WebPerf`.

## Working Principles

- Keep runtime and persistence choices self-host friendly.
- Keep core domain logic reusable through `packages/domain-core` and `packages/report-core`.
- Prefer generic contracts and extension points over provider-specific assumptions.
- Keep the console, API service, scheduler, and probe runnable on a small single-org installation.
- Keep public package and runtime ownership clear so managed cloud code can consume this repo without forking it.

## Local Checks

Run these before opening a PR:

```sh
bun run check
bun test apps/api/test
cargo test --workspace --manifest-path apps/probe-rs/Cargo.toml
bun test packages/domain-core/test/*.test.ts
```

For Svelte files, run:

```sh
npx @sveltejs/mcp svelte-autofixer apps/console/src/routes/+page.svelte
```

## Release Notes

Use Sampo for release metadata in this repo.

```sh
bun run sampo:add
bun run sampo:release:dry-run
```

Add the Sampo changeset file under `.sampo/changesets/` in the same PR as the user-facing change.

## Runtime Images

When a change affects reusable runtimes, keep the corresponding Dockerfile,
Compose service, CI image matrix, and release image matrix aligned. Run:

```sh
bun run check:release
```

Pushes to `main` publish `main` and source-SHA development tags only after
required CI passes. Tagged releases publish all six versioned images and a
digest-bearing `runtime-metadata.json`; managed consumers fetch that file from
a specific GitHub Release.
