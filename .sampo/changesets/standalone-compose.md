---
npm/@webperf/config: minor
---

Make the default self-host deployment a true two-container stack: one
supervised `webperf` container for the console, API, embedded scheduler, and
durable executor, plus the separate Rust `webperf-probe` trust boundary. The
optional Lighthouse Browser Audit runner remains a third profile container,
and split `webperf` roles remain available for development and maintenance.
The standalone supervisor launches the public console, API, and executor under
distinct non-root UIDs with only the capabilities needed to set those
identities and stop its children.
