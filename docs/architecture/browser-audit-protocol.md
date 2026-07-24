# Browser Audit Protocol v1

The public Browser Audit Protocol describes normalized results rather than a
specific audit engine. The optional runner in `apps/browser-audit-lighthouse`
is the Lighthouse reference implementation; a self-host operator can build a
different runner without changing API, persistence, or console result shapes.

## Result shape

Every successful result contains:

- `protocolVersion`
- `coreMetrics` for FCP, LCP, CLS, INP, TBT, and Speed Index
- normalized `scores` in the `0..1` range, with extension keys using
  lowercase-start alphanumeric identifiers
- open, uniquely identified `extendedMetrics`
- navigation, snapshot, or timespan `checkpoints`
- normalized `issues`
- artifact references
- an engine-neutral `toolchain`
- `startedAt` and `completedAt`

The toolchain records an engine, browser, runtime, and component list. The
Lighthouse runner reports Lighthouse as the engine, Chrome as the browser, Bun
as the runtime, and Puppeteer plus the reference runner as components.

## Artifact registry

Artifact registry `v1` reserves these standard kinds:

- `lighthouse-json`
- `lighthouse-html`
- `screenshot`
- `trace`
- `har`
- `filmstrip`
- `video`
- `waterfall`
- `log`

Kinds are validated strings rather than a closed enum. A compatible engine may
publish an extension such as `sitespeed-summary`; consumers must render unknown
kinds generically instead of rejecting the result.

## Compatibility fixtures

Checked-in Lighthouse and sitespeed.io fixtures live under
`packages/contracts/test/fixtures/browser-audit`. The sitespeed.io fixture is a
contract test only; this repository does not ship a sitespeed.io runner.

The parser also upgrades the pre-v1 Lighthouse-shaped `summary` and fixed
toolchain fields when reading existing SQLite records. New writes always use
the normalized v1 shape.
