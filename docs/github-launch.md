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

## License Options

This repo should not guess the license at random. The decision changes how easy it is for others to adopt and extend the OSS core.

Recommended candidates:

### Apache-2.0

Choose this if the goal is broad adoption with a clear patent grant.

Pros:

- familiar and low-friction for infrastructure and developer-tool repos
- easier for companies to adopt internally
- explicit patent language

Tradeoff:

- downstreams can modify and host derivatives without sharing those modifications back

### MIT

Choose this only if you want the simplest highly permissive option.

Pros:

- minimal, familiar, easy to understand

Tradeoff:

- weaker patent posture than Apache-2.0
- gives up essentially all leverage over private forks

### MPL-2.0

Choose this if you want a weak-copyleft middle ground.

Pros:

- modified source files must stay shareable
- still easier to adopt than full copyleft

Tradeoff:

- some teams will avoid it compared with Apache-2.0
- adds more legal review friction than permissive licenses

## Recommendation

Default recommendation:

- pick `Apache-2.0` if the main goal is adoption and ecosystem reach
- pick `MPL-2.0` if the main goal is protecting direct file-level modifications to the OSS core

Do not publish without a real `LICENSE` file. That is the last major public-launch blocker left in this repo.

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
