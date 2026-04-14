# Contributing

This repo is the self-hosted edition of Webperf and Guide.

## Working Principles

- Keep runtime and persistence choices self-host friendly.
- Keep core domain logic reusable through `packages/domain-core` and `packages/report-engine`.
- Prefer generic contracts and extension points over provider-specific assumptions.
- Keep the console, control service, and probe runnable on a small single-org installation.

## Local Checks

Run these before opening a PR:

```sh
bun run check
bun test apps/control/test
cargo test --workspace --manifest-path apps/probe-rs/Cargo.toml
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
