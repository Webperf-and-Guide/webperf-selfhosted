# Design System

`@webperf/ui` is the source of truth for shared token semantics used across:

- `webperf-selfhosted/apps/console`
- `webperf.and.guide/apps/console`
- `webperf.and.guide/apps/marketing`

## Theme modes

- `operator`
  - default for both consoles
  - dark, dense, restrained
- `brand`
  - default for marketing surfaces
  - lighter, editorial, still tied to the warm WebPerf accent family
- `brand-dark`
  - optional supporting mode for hero or feature sections in marketing

## Token names

The semantic surface should stay stable even if the palette changes.

- `canvas`
- `surface`
- `surface-strong`
- `text`
- `muted`
- `line`
- `accent`
- `accent-soft`
- `success`
- `warning`
- `danger`

Typography, spacing, radii, and shadows also live in the shared token layer and should be updated
in `packages/ui/src/styles/theme.css`, not per-app.

## CSS entrypoints

- operator apps import `@webperf/ui/styles/operator-app.css`
- marketing imports `@webperf/ui/styles/marketing-app.css`

These files expose the common shell, section, and dense operator workspace classes. App-level CSS
should stay thin and mostly just import Tailwind and the shared theme entrypoint.

## shadcn-compatible structure

The shared package now carries the canonical shadcn-compatible surface:

- `packages/ui/components.json`
- `packages/ui/src/lib/utils.ts`
- `packages/ui/src/lib/components/ui/*`

Each Svelte UI app still includes:

- `components.json`
- `src/lib/utils.ts`
- `src/lib/components/ui/*`

The local component directories should re-export primitives from `@webperf/ui` unless an app truly
needs a private variant. The shared baseline and extras now have thin re-export shims in the
console and cloud apps for:

- `copy-button`
- `field-set`
- `number-field`
- `scroll-area`
- `tabs`
- `underline-tabs`
- `checkbox`
- `switch`
- `table`

## shadcn-svelte and jsrepo workflow

`@webperf/ui` is the place to land shared primitives and extras.

- use `shadcn-svelte` when we want to align the shared package or an app surface with upstream
  shadcn-svelte conventions
- use `jsrepo` with `@ieedan/shadcn-svelte-extras` when we want to pull extras into the shared UI
  package instead of copy-pasting app-local variants

Current shared component baseline in `packages/ui/src/lib/components/ui`:

- `button`
- `input`
- `textarea`
- `select`
- `badge`
- `card`
- `separator`
- `tabs`
- `scroll-area`
- `dialog`
- `popover`
- `tooltip`
- `checkbox`
- `switch`
- `table`

Current `shadcn-svelte-extras` items adopted through `jsrepo`:

- `underline-tabs`
- `field-set`
- `number-field`
- `tags-input`
- `copy-button`

Root workflow:

- `bun run ui:jsrepo:add:extras -- <item>`
- `bun run ui:jsrepo:update -- <item>`
- `bun run ui:jsrepo:mcp:codex`

The checked-in `jsrepo.config.ts` routes extras into:

- `packages/ui/src/lib/components/ui`
- `packages/ui/src/lib/hooks`
- `packages/ui/src/lib/actions`

That keeps the self-hosted repo as the source of truth and avoids forking a separate cloud-only
component layer.

Preferred app import shape:

- `@webperf/ui/components/ui/*` for shared components
- `@webperf/ui/components/operator/*` for shared console-level composites
- `@webperf/ui/styles/*` for app entrypoint CSS
- `@webperf/ui/utils` for `cn` and utility helpers

Use the root `@webperf/ui` barrel only for shared shell metadata like nav definitions and theme
descriptors. Shared app screens should not import primitives directly from `@webperf/ui/primitives/*`.

## Repo-local console controllers

Console orchestration stays repo-local even when the rendered surface is shared.

- `apps/console/src/lib/console-workspace/*.svelte.ts` owns mutable form state, route-specific derived
  state, pagination, submit/delete handlers, live-run orchestration, and region toggle helpers
- `ConsoleWorkspace.svelte` should stay focused on shaping `data` + `mode`, creating controllers,
  and composing route surfaces
- cloud should mirror this pattern in its own repo-local controller folder instead of trying to
  share action wiring through `@webperf/ui`

## Operator composites

Higher-level console presentation now lives under `packages/ui/src/lib/components/operator/*`.

Current first-wave shared operator components:

- `metric-grid`
- `resource-count-strip`
- `region-quick-pick`
- `run-status-panel`
- `comparison-summary-panel`
- `saved-check-summary-card`
- `derived-resource-panel`

Current setup and list-management operator components:

- `resource-workflow-strip`
- `resource-inventory-strip`
- `resource-editor-panel`
- `paged-list-toolbar`

Current operator polish helpers:

- `operator-section-header`
- `operator-empty-state`
- `inline-status-notice`

These components are presentational-first and should accept normalized props from the app layer.
They should not fetch data, submit forms, or absorb control-plane/runtime assumptions.

## Future primitives

Add future primitives in this order:

1. implement the primitive in `packages/ui`
2. export it from `@webperf/ui`
3. if it comes from `shadcn-svelte-extras`, bring it in through `jsrepo` at the repo root
4. re-export it from app-local `src/lib/components/ui/*`
5. document any new token dependency here if it expands the shared semantic surface
