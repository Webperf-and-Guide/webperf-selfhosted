# Execution Model

The product keeps contracts and reporting stable while leaving room for multiple execution backends.

## Current Default

Today the default execution path is:

- `apps/control` stores configuration and run history
- `apps/probe-rs` performs network measurements
- `packages/contracts` and `packages/report-engine` shape the stored results

## Design Rule

Execution details should stay behind a small boundary:

- contracts describe what ran and what came back
- reports summarize and compare those results
- the control service decides when to dispatch work
- probe runtimes decide how to execute the measurement

## Result Metadata

Contracts may carry generic execution metadata such as:

- `runnerType`
- `provider`
- `locationMode`

That keeps the console and reports stable even when new executors are added later.
