# Console Information Architecture

First-pass information architecture for the self-hosted operator console.

## Problem

The current console grew into one mixed page that tries to be:

- manual run cockpit
- live run stream viewer
- resource admin
- saved check builder
- report and comparison browser
- region catalog

That makes the screen feel noisy even when each individual feature is useful.

## Operator Model

The console should optimize for this operator loop:

1. run a check now
2. define reusable resources
3. save a repeatable check
4. inspect comparisons, exports, and recent run history
5. review the active region corridor only when needed

That means the UI should be organized around workflow, not around every internal entity at once.

## First-Pass Structure

Current first-pass section split:

- `Run`
  - manual verification form
  - live control-plane stream
- `Resources`
  - sites
  - route groups
  - region sets
- `Checks`
  - saved check editor
  - saved check browser
  - baseline and recent-run actions
- `Reports`
  - derived comparisons
  - exports
  - analyses
- `Regions`
  - reference catalog for the active corridor

## Route Split

The console now exposes the workflow split as real routes:

- `/`
  - operator overview
  - manual run
  - current live job
- `/resources`
  - sites
  - route groups
  - region sets
- `/checks`
  - saved check builder and browser
- `/reports`
  - comparisons
  - exports
  - analyses
- `/regions`
  - active corridor and reference catalog

The current implementation uses a shared workspace component underneath those routes so the
operator split is real at the URL level without forking the data-fetching or control action logic.

## Refactor Priorities

1. Keep breaking the shared workspace component into smaller route-scoped components instead of one large script.
2. Preserve the shared route loader so the route split does not duplicate control-plane fetch logic.
3. Keep the homepage reduced to operator-critical surfaces only.
4. Keep the region catalog as a reference surface, not the center of the product.
5. Pull more report and run-detail rendering into dedicated presentational components.
