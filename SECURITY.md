# Security Policy

## Scope

This repository contains the self-hosted/open-core `WebPerf` product:

- self-host console, API, scheduler, and probe runtime
- public contracts and deterministic reporting logic
- optional browser-audit worker runtime

Managed cloud orchestration and hosted operations live in the separate `webperf.and.guide` repo.

## Reporting A Vulnerability

If you believe you have found a security issue, please do not open a public GitHub issue with exploit details.

Until a dedicated security inbox is published, use a private disclosure path with the maintainer or repository owner and include:

- affected component or path
- impact and attack preconditions
- reproduction steps or proof of concept
- suggested remediation if available

Please clearly mark the report as `security`.

## Response Expectations

Best effort targets once the repo is public:

- initial acknowledgement within 5 business days
- status update after triage
- coordinated disclosure after a fix or mitigation is ready

## Hardening Areas

Security-sensitive areas in this repo include:

- request signing between control-plane components and probe/browser-audit runtimes
- self-host secret handling in Compose and env parsing
- URL validation and SSRF boundaries
- report/export surfaces that proxy or serialize user-controlled data
- Docker runtime hardening for reusable images

## Supported Branch

Until versioned releases are formalized, `main` is the supported branch for security fixes.
