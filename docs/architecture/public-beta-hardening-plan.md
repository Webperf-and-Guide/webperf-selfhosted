# Public beta hardening plan

Status: in progress  
Owner: self-hosted maintainers  
Started: 2026-07-22

## Goal

Move `webperf-selfhosted` from a working development project to an installable,
upgradeable public beta without replacing its existing console, API, SQLite,
scheduler, Rust probe, browser audit runner, or shared packages.

The public repository remains the source of truth for the self-hosted product,
public contracts, deterministic reporting, the engine-neutral Browser Audit
Protocol, the Lighthouse reference runner, reusable runtime images, and the
versioned Compose bundle. Managed-cloud identity, billing, quotas, provider
orchestration, hosted runner fleets, AI features, and provider marketing remain
out of scope.

## Current state

The repository already has a functional Svelte console, Bun API and scheduler,
SQLite persistence, a Rust probe, an optional Lighthouse-based browser audit
worker, public/app/ops oRPC contracts, canonical REST aliases, deterministic
comparison/reporting, local Compose smoke tests, and GHCR publishing for the
probe and browser audit image.

The audit on 2026-07-22 found the following public-beta blockers:

- the API starts execution with fire-and-forget `void processJob()` calls;
- there is no independently restartable executor or durable execution lease;
- SQLite tables are created inline without versioned migrations or operational
  backup, restore, integrity, and maintenance commands;
- production code still contains a fixed probe secret fallback;
- API data and execution routes do not enforce the single-organization admin
  token model;
- the scheduler has no internal-service authentication;
- the default Compose file builds local images and publishes API and browser
  runner ports to the host;
- network URL validation does not pin the validated DNS result to the actual
  connection, leaving a DNS rebinding/TOCTOU gap;
- browser navigation and subresource requests do not yet enforce a complete
  public-internet-only policy;
- custom request headers, cookies, and webhook secrets are persisted as plain
  JSON values and rendered back through APIs;
- Browser Audit creation runs synchronously inside the API process;
- the public Browser Audit toolchain and artifact kind schemas are tied to the
  Lighthouse implementation;
- the runner can send artifact uploads, but the API does not provide the
  corresponding authenticated local-filesystem upload/download implementation;
- release images, versioned Compose bundles, SBOM, provenance, and digest
  metadata are not produced as one gated release workflow;
- user documentation still centers on development-era paths and does not yet
  cover the complete install/backup/upgrade/security lifecycle.

## Planned file changes

The exact diff will stay small within each phase, but the expected surface is:

- `apps/api/**`: authenticated HTTP boundary, queued-resource creation,
  migration-aware repository access, artifact endpoints, and capability truth;
- `apps/executor/**`: lease claim/renewal, retry, network/browser execution,
  evaluation, webhook delivery, recovery, and graceful shutdown;
- `apps/scheduler/**`: authenticated due-check dispatch only;
- `apps/probe-rs/**`: required secrets, DNS/IP validation and connection pinning,
  redirect revalidation, metric capability parity, and fixtures;
- `apps/browser-audit-lighthouse/**`: renamed Lighthouse reference runner,
  browser request policy, normalized protocol output, and artifact upload;
- `apps/console/**`: server-only admin token forwarding, masked secret inputs,
  asynchronous audit status, authenticated artifact links, and canonical terms;
- `packages/contracts/**`: execution, artifact, capability, and engine-neutral
  Browser Audit schemas plus compatibility fixtures;
- `packages/domain-core/**`: shared signing, secret redaction/encryption helpers,
  URL policy, and deterministic identifiers;
- `packages/config/**`: strict production configuration for API, console,
  scheduler, executor, probe, and runner;
- `packages/report-core/**`: evaluation compatibility with durable executions;
- `infra/docker-compose/**`: versioned production bundle and source-build
  override;
- `infra/release/**`: release bundle and image metadata generation;
- `infra/examples/**`: reverse proxy and operator-safe configuration examples;
- `tooling/scripts/**`: init, migrate, backup, restore, doctor, maintenance,
  boundary, docs, integration, and release checks;
- `.github/workflows/**`: required JS/Rust/docs/image/integration CI and gated
  release publishing;
- `docs/users/**`, `docs/contributors/**`, `docs/architecture/**`, and
  `docs/security/**`: public-beta user and maintainer documentation;
- `README.md`, `SECURITY.md`, `CHANGELOG.md`, `.sampo/changesets/**`, and
  `AGENTS.md`: public entrypoint, release metadata, and living execution state.

## Migration impact

- Existing `jobs`, `saved_entities`, and `check_profile_runs` payloads must be
  preserved byte-for-byte unless an explicit compatibility transform is needed.
- A `schema_migrations` table will record ordered migration identifiers.
- A new `execution_jobs` table will store durable queue/lease/retry state.
- Artifact index data will be persisted as metadata only; binary artifacts will
  live below the configured artifact directory.
- Sensitive inline values will be migrated to encrypted values or explicit
  environment-backed secret references without exposing cleartext through
  reads, exports, logs, or errors.
- Production migration can optionally create a timestamped database backup
  before applying pending migrations.
- Upgrade documentation will state the minimum compatible version, backup
  procedure, rollback boundary, and any one-way migration.

## Compatibility impact

- Canonical public names are Site, Route Group, Region Set, Check, Run,
  Comparison, Export, Analysis, and Browser Audit.
- Canonical routes remain `/v1/sites`, `/v1/route-groups`, `/v1/region-sets`,
  `/v1/checks`, nested check runs, run detail, comparisons, exports, analyses,
  browser audits, and capabilities.
- `/v1/properties`, `/v1/route-sets`, `/v1/region-packs`, and
  `/v1/check-profiles` remain tested compatibility aliases during beta, but will
  return deprecation and successor-link headers and will not receive new
  features first.
- Existing stored JSON payloads and the legacy control contract remain readable
  while cloud consumers move to canonical public contracts.
- Browser Audit normalized contracts will receive a new public package version;
  a sitespeed.io-shaped fixture will prove engine neutrality without shipping a
  sitespeed.io runner.

## Security impact

- All data and execution endpoints will require `SELFHOST_ADMIN_TOKEN`; only
  health, capabilities, and the public OpenAPI document remain unauthenticated.
- Console server code will attach the admin token without serializing it into
  browser JavaScript.
- Scheduler and executor will authenticate with `SELFHOST_INTERNAL_SECRET`.
- Probe and Lighthouse runner will use independent current/next HMAC secrets.
- Production startup will fail on missing required secrets; init will generate
  cryptographically random values.
- Network and browser execution will default to public HTTP(S) ports 80/443,
  block local/private/special-use destinations, revalidate redirects, and pin
  validated DNS results where the runtime supports it.
- Header, cookie, webhook, URL-query, log, export, and error data will use a
  shared redaction policy; sensitive execution values will be encrypted at rest
  or resolved by an environment secret reference.
- Artifact upload/download will enforce signed short-lived tokens, normalized
  filenames, allowlisted content types, size limits, and traversal-safe paths.
- Default Compose will publish only the console on `127.0.0.1`; internal service
  ports will be available only inside Compose, with loopback debug exposure in
  an explicit profile.

## Implementation checklist

### 1. Boundary and naming

- [x] Rename the legacy browser-audit worker app to
  `apps/browser-audit-lighthouse` and update package/image identifiers.
- [x] Add `apps/executor` and keep implemented execution handlers out of the API
  and scheduler.
- [x] Make canonical terms/routes primary in UI, docs, contracts, and tests.
- [x] Add deprecation headers and successor links to compatibility routes.
- [x] Remove provider-specific cloud config, health contracts, smoke scripts,
  and console deployment adapters from the self-hosted tree.
- [x] Add a Sampo changeset for public naming/package changes.

### 2. Security defaults

- [x] Add admin/internal/current-next secret schemas and strict startup checks.
- [x] Add API authentication and server-only console token forwarding.
- [x] Encrypt or reference sensitive execution inputs and mask all reads.
- [x] Add shared redaction for logs, errors, exports, and URL queries.
- [x] Complete network and browser SSRF enforcement with fixtures.
- [x] Add a Sampo changeset for authentication and security behavior.

### 3. Executor and SQLite leases

- [x] Add ordered migrations, WAL, busy timeout, foreign keys, and graceful
  close.
- [x] Add the required `execution_jobs` columns, indexes, and atomic claim.
- [x] Add internal-only claim/start/renew/complete/fail transport plus
  single-concurrency heartbeat and graceful claim shutdown in `apps/executor`.
- [x] Add lease-bound context/result/follow-up transport so handlers can persist
  domain results atomically without opening SQLite from the executor.
- [x] Move network probe, run evaluation, and webhook handlers into
  `apps/executor` with retry and idempotent result persistence.
- [x] Move Browser Audit execution into `apps/executor` and make API creation
  asynchronous.
- [x] Keep scheduler limited to authenticated due-check dispatch.
- [x] Add init/migrate/backup/restore/doctor/maintenance commands.
- [x] Add restart-recovery and scheduler-dispatch integration tests.
- [x] Add a Sampo changeset for durable execution; extend it with database
  operations before this phase closes.

### 4. Browser Audit Protocol

- [x] Replace fixed Lighthouse toolchain fields with engine/browser/runtime and
  component records.
- [x] Normalize core metrics, scores, extended metrics, checkpoints, issues,
  artifacts, toolchain, and timestamps.
- [x] Make artifact kinds extensible while registering standard kinds.
- [x] Preserve Lighthouse user-flow support and add engine-neutral fixtures.
- [x] Report Fast Check capabilities truthfully; unsupported TCP/TLS fields stay
  null with capability flags false.
- [x] Add a Sampo changeset for the public contract version.

### 5. Artifact storage

- [x] Add local-filesystem artifact index persistence.
- [x] Issue short-lived upload configuration to the runner.
- [x] Validate upload size, type, filename, token, and audit ownership.
- [x] Add authenticated streaming download and retention cleanup.
- [x] Keep S3-compatible storage as an interface/extension point only.
- [x] Add upload/download/traversal/retention integration tests.
- [x] Add a Sampo changeset for local artifact persistence.

### 6. Compose

- [x] Make `compose.yml` consume versioned GHCR images.
- [x] Add `compose.dev.yml` source-build overrides.
- [x] Publish only console on loopback by default; add a debug profile.
- [x] Add health checks, restart/stop policies, non-root execution, read-only
  filesystems where possible, tmpfs, log rotation, and resource examples.
- [x] Keep Lighthouse optional, sandboxed, single-concurrency, and host-port
  free without default `SYS_ADMIN`.
- [ ] Validate default and browser-audit Compose smoke paths.
- [x] Add a Sampo changeset for install/runtime behavior.

### 7. CI and release

- [x] Require frozen install, boundaries, retired paths, OpenAPI, TS/Svelte,
  domain/report/API, Rust fmt/clippy/test, docs links, and absolute-path checks.
- [x] Build every runtime image, including Linux/amd64 probe and Lighthouse.
- [x] Run durable recovery, scheduler, comparison, artifact, redaction, and SSRF
  integration coverage.
- [x] Gate publishing on CI; produce version tags, release bundle, SBOM,
  provenance, and digest-bearing runtime metadata.
- [x] Ensure release Compose uses immutable version/digest references, never
  `main` or `latest`.
- [x] Add a Sampo changeset for release automation.

### 8. Documentation

- [ ] Reorder README around Docker installation and operator outcomes.
- [ ] Add install, configure, regions, checks, scheduling, browser audits,
  artifacts, backup/restore, upgrade, security, troubleshooting, reverse proxy,
  and cloud-vs-self-hosted user guides.
- [ ] Move contributor setup below operator guidance.
- [ ] Remove local absolute paths and validate all documentation links.
- [ ] Document Browser sandboxing, trusted single-organization deployment, TLS,
  and additional access-control expectations.
- [ ] Add a Sampo changeset for user-facing documentation.

## Completion gates

- [ ] A clean host can install a tagged, digest-pinned Compose bundle.
- [ ] Default host exposure is console-only on loopback.
- [ ] Required production secrets have no fallback.
- [x] Manual Fast Check and scheduled Check execution work through the executor.
- [x] Leased work recovers after API/executor restart.
- [ ] Baseline/latest comparisons and deterministic analyses work.
- [x] Browser Audit creation and execution are asynchronous.
- [x] Browser Audit stores downloadable local artifacts.
- [ ] Secrets are absent from database API views, logs, exports, and errors.
- [ ] Network and browser SSRF fixtures pass.
- [ ] Canonical REST/OpenAPI surfaces agree and compatibility tests pass.
- [ ] JS, Rust, docs, image, and integration CI all pass.
- [ ] Release automation emits tagged artifacts, SBOM, provenance, and digests.
- [ ] No cloud-only or provider-specific orchestration is imported.

Each implementation commit is reviewed with `ocr review --commit <sha>`.
Review findings are fixed before the phase is considered complete. After the
branch is published, unresolved PR review threads are addressed and re-reviewed
until no actionable comments remain before merging to `main`.
