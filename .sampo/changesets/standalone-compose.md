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
identities and stop its children. It keeps the API and console available while
waiting for the separate probe to become healthy, then starts the executor so
routine stack startups do not exhaust queued work attempts. Database maintenance
and recovery commands continue to run as the persistent data owner rather than
inheriting the supervisor identity. Custom-Compose upgrade guidance now states
the exact supervisor identity, capability, and `no-new-privileges` boundary
required by the standalone role.
