# Execution Model

The product keeps contracts and reporting stable while leaving room for multiple execution backends.

## Current Default

Today the default execution path is:

- `apps/api` stores configuration and run history
- `apps/scheduler` only polls the internal-authenticated due-Check dispatch
  endpoint
- `apps/executor` claims durable SQLite-backed execution leases and owns probe,
  Browser Audit, evaluation, retry, and webhook work
- `apps/probe-rs` performs network measurements
- `packages/contracts` and `packages/report-core` shape the stored results

Optional runtimes may live alongside that path without becoming a default dependency.
Today that includes `apps/browser-audit-lighthouse`, which remains a standalone runtime surface.
Its output follows the engine-neutral
[Browser Audit Protocol](./browser-audit-protocol.md), so Lighthouse remains a
replaceable reference engine rather than a public-contract dependency.

## Design Rule

Execution details should stay behind a small boundary:

- contracts describe what ran and what came back
- reports summarize and compare those results
- the API stores state and exposes dispatch surfaces
- the scheduler requests due-work dispatch on its configured interval; the API
  atomically creates Runs and queue rows
- the executor owns execution leases and calls probe runtimes
- Browser Audit upload credentials use a dedicated lease-bound grant endpoint;
  they are not embedded in the general execution context or persisted queue payload
- probe runtimes decide how to perform an individual measurement
- optional runtimes can expose extra capabilities without forcing them into the default self-host stack

## Result Metadata

Contracts may carry generic execution metadata such as:

- `runnerType`
- `provider`
- `locationMode`

That keeps the console and reports stable even when new executors are added later.

Expired `leased` or `running` rows are reclaimed atomically by a later executor
with an incremented attempt count. The checked-in restart integration test
stops and starts the API three times against one SQLite file, changes executor
identity after lease expiry, completes the recovered work, and verifies it is
not claimable after another restart.
