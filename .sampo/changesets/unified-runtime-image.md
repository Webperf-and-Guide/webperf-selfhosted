---
npm/@webperf/config: minor
npm/@webperf/domain-core: minor
---

Consolidate four Bun runtime images into one `webperf` image and embed the
scheduler in the API. The published GHCR image set changes from six images
(`webperf-console`, `webperf-api`, `webperf-scheduler`, `webperf-executor`,
`webperf-probe`, `webperf-browser-audit-lighthouse`) to three
(`webperf`, `webperf-probe`, `webperf-browser-audit-lighthouse`). Console,
API, scheduler, and executor are now runtime roles selected by the
`WEBPERF_ROLE` environment variable in the single `webperf` image. The
scheduler defaults to embedded mode inside the API process
(`SELFHOST_SCHEDULER_MODE=embedded`); external mode remains available.
This is a breaking change for consumers pinned to the old six-image
digest-pinned Compose bundle.
