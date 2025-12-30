# Runtime & Toolchain Matrix (Build Automation v1)

This page defines what “supported” means for BrikByteOS Pipelines build automation.

## The Rule
**LTS-first + N/N-1**:

- We prefer vendor LTS releases.
- We support current LTS (N) and previous LTS (N-1) where feasible.
- Anything outside this window is **experimental** and must be explicitly marked.

## Why this exists
Without a single source of truth:
- templates drift
- validation becomes subjective
- onboarding slows
- audits become messy

## Canonical Source
The authoritative file is:

- `docs/pipelines/runtime-matrix.yml`

## How templates use this
Reusable workflows use:
- `defaultVersion`
- `defaultCommands`
- allowed tools under `toolchain.*.allowed`

## How validation uses this
The build config validator (PIPE-CORE-1.1.4) enforces:
- runtime version is in `supportedVersions`
- tool is allowed for the stack
- defaults are resolved from the matrix

## Deprecation
- Deprecation follows vendor EOL.
- Removal happens **one quarter after EOL** unless an explicit exception is approved.

## Change process
- Changes require PR review by Platform Engineering.
- Quarterly review is mandatory.
- Update `CHANGELOG.md` whenever defaults or supported versions change.
