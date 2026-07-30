# Contributor development

Operator installs should use a tagged release bundle. This guide is for source
changes to the console, API, scheduler, executor, probe, public packages, or
deployment tooling.

## Toolchain

- Bun `1.3.13` from the root `packageManager` field;
- Rust `1.86.0` for `apps/probe-rs`;
- Docker Engine and Compose v2 for image and integration smoke tests;
- Node.js/npm only for `npx`-based Svelte and Playwright helpers.

## Install and run

```sh
bun install --frozen-lockfile
bun run dev
```

The development wrapper creates process-local random secrets and starts the
console, API, scheduler, executor, and Rust probe. Default addresses are:

- console: `http://localhost:5173`;
- API: `http://127.0.0.1:8788`;
- probe: `http://127.0.0.1:8080`.

Local SQLite and artifacts are ignored development data. Do not commit them or
use a production database with watch-mode processes.

Run the optional Lighthouse reference runner separately:

```sh
BROWSER_AUDIT_SHARED_SECRET=replace-with-a-dev-secret \
  bun run dev:browser-audit-lighthouse
```

Use [parallel local development](../quickstart/parallel-local-dev.md) or the
documented port environment variables when another project owns a default
port.

## Required checks

```sh
bun run check
bun test
bun run compose:config

cargo fmt --all --check --manifest-path apps/probe-rs/Cargo.toml
cargo clippy --workspace --all-targets \
  --manifest-path apps/probe-rs/Cargo.toml -- -D warnings
cargo test --workspace --manifest-path apps/probe-rs/Cargo.toml
```

Use `bun run smoke:compose` and `bun run smoke:compose:browser-audit` when a
change affects images, Compose, health behavior, networking, or optional audit
execution.

## TypeScript code graph

The repository pins TypeScript 7, `ttsc`, and `@ttsc/graph` so contributors and
coding agents can build the compiler-resolved runtime graph without downloading
an unversioned launcher. The graph intentionally covers the TypeScript control
plane and public core; Svelte components continue to use `svelte-check`.

Verify the local native graph binary and inspect the dump with:

```sh
bun run graph:dump > /tmp/webperf-ttsc-graph.json
```

For an MCP client, start `ttsc-graph` from the repository root with
`--tsconfig tsconfig.graph.json`. The MCP server keeps the graph resident, so a
separate checked-in dump is not required.

For every edited `.svelte` file, run the Svelte autofixer on that file and then
the console checks:

```sh
npx @sveltejs/mcp svelte-autofixer apps/console/src/routes/+page.svelte
bun run --cwd apps/console check
```

## Repository boundaries

- Put reusable domain behavior in `packages/domain-core` or
  `packages/report-core`.
- Keep public schemas and compatibility behavior in `packages/contracts`.
- Keep managed billing, tenancy, private provider orchestration, and AI analyst
  product behavior out of this repository.
- Treat `apps/browser-audit-lighthouse` as one reference engine behind the
  public protocol.
- Update `AGENTS.md` when meaningful progress changes the living snapshot.

Read [CONTRIBUTING.md](../../CONTRIBUTING.md), add a
[Sampo changeset](./releases.md), and keep commits small enough to review.
