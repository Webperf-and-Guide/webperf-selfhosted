# Execution Model

The product keeps contracts and reporting stable while leaving room for multiple execution backends.

## Current Default

Today the default execution path is:

- `apps/api` stores configuration and run history
- `apps/scheduler` polls the dispatch endpoint for due saved checks
- `apps/probe-rs` performs network measurements
- `packages/contracts` and `packages/report-core` shape the stored results

Optional runtimes may live alongside that path without becoming a default dependency.
Today that includes `apps/browser-audit-worker`, which remains a standalone runtime surface.

## Design Rule

Execution details should stay behind a small boundary:

- contracts describe what ran and what came back
- reports summarize and compare those results
- the API stores state and exposes dispatch surfaces
- the scheduler decides when to trigger scheduled work
- probe runtimes decide how to execute the measurement
- optional runtimes can expose extra capabilities without forcing them into the default self-host stack

## Result Metadata

Contracts may carry generic execution metadata such as:

- `runnerType`
- `provider`
- `locationMode`

That keeps the console and reports stable even when new executors are added later.
