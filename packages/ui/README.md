# @webperf/ui

Shared UI package for `WebPerf`.

## What lives here

- shared theme tokens and CSS entrypoints
- shadcn-compatible shared primitives
- future `shadcn-svelte-extras` items pulled in through `jsrepo`

## Canonical entrypoints

- `@webperf/ui`
- `@webperf/ui/styles/operator-app.css`
- `@webperf/ui/styles/marketing-app.css`
- `@webperf/ui/components/ui/button`
- `@webperf/ui/components/ui/input`
- `@webperf/ui/components/ui/card`
- `@webperf/ui/components/ui/field-set`
- `@webperf/ui/components/ui/underline-tabs`
- `@webperf/ui/components/ui/copy-button`
- `@webperf/ui/components/operator/metric-grid`
- `@webperf/ui/components/operator/saved-check-summary-card`
- `@webperf/ui/components/operator/derived-resource-panel`
- `@webperf/ui/utils`

## Consumption model

This package is the source of truth for both:

- `webperf-selfhosted/apps/console`
- `webperf.and.guide/apps/console`
- `webperf.and.guide/apps/marketing`

During local cross-repo development, the cloud repo should consume this package through sibling
`file:` dependencies instead of `bun link`. That keeps installs deterministic and matches CI.

The preferred screen-level import style is:

- `@webperf/ui/components/ui/*` for components
- `@webperf/ui/components/operator/*` for shared console-level composites
- `@webperf/ui/styles/*` for shared CSS entrypoints
- `@webperf/ui/utils` for utility helpers

Use the root `@webperf/ui` barrel for shell metadata such as nav links or theme descriptors, not
for app-level primitive imports.

## Adding shared extras

From the repo root:

```bash
bun run ui:jsrepo:add:extras -- <item>
```

Examples:

```bash
bun run ui:jsrepo:add:extras -- underline-tabs
bun run ui:jsrepo:add:extras -- field-set
```

Those additions should land in `src/lib/components/ui` and then be re-exported by consuming apps as
needed.

Currently adopted extras:

- `underline-tabs`
- `field-set`
- `number-field`
- `tags-input`
- `copy-button`

Current shared operator composites:

- `metric-grid`
- `resource-count-strip`
- `region-quick-pick`
- `run-status-panel`
- `comparison-summary-panel`
- `saved-check-summary-card`
- `derived-resource-panel`
