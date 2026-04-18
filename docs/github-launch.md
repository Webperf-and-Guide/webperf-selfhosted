# GitHub Launch Guide

Use this document when turning `webperf-selfhosted` into a public GitHub repository.

## Recommended Repo Description

Suggested description:

`Self-hosted WebPerf for release verification, regional network probes, scheduled checks, and baseline diffing.`

Shorter variant:

`Self-hosted WebPerf for regional release verification and baseline diffing.`

## Suggested Topics

Recommended initial topics:

- `web-performance`
- `release-verification`
- `synthetic-monitoring`
- `self-hosted`
- `svelte`
- `bun`
- `rust`
- `cloudflare-workers`
- `docker-compose`
- `lighthouse`

Only keep topics that match the code actually shipped here. Avoid adding SaaS-only or AI-first topics that belong to `webperf.and.guide`.

## Suggested Homepage

If a marketing/home page is available later, use the managed product URL as the homepage:

- `https://webperf.and.guide`

If that would blur the OSS/cloud split too much, leave the homepage unset until the docs site or OSS landing page is ready.

## README Front-Door Goals

The public README should help a new visitor answer these questions within a minute:

1. What problem does this solve?
2. Is this self-hosted and usable on its own?
3. What runtimes and deployment modes are included?
4. What is intentionally *not* included because it belongs to the managed cloud product?

The current README is already close; avoid turning it into an exhaustive architecture document.

## Launch Packaging Policy

For the first public launch:

- keep the repo as the source of truth for `@webperf/*`
- keep runtime image delivery on GHCR
- do not treat npm package publishing as a launch blocker

If external consumers later need versioned packages, consider publishing only:

- `@webperf/contracts`
- `@webperf/config`
- `@webperf/domain-core`
- `@webperf/report-core`
- `@webperf/ui`

## License

Selected license:

- `Apache-2.0`

Why this choice:

- broad adoption for infra and developer-tooling users
- explicit patent grant
- low friction for companies evaluating self-hosted deployment

The checked-in [LICENSE](../LICENSE) file is now part of the public-launch baseline.

## GitHub Repo Settings Checklist

- enable Discussions only if you want roadmap and usage questions in GitHub rather than docs/issues
- enable Issues with templates
- protect `main`
- keep Packages enabled for GHCR image publishing
- add the repo description and topics above
- upload a social preview image later if the project gets a dedicated visual identity

## First Public Issue Templates

The repo should start with:

- bug report
- feature request
- a config file that points security reports to `SECURITY.md`

Those templates are now checked in under `.github/ISSUE_TEMPLATE/`.
