# Release SemVer Policy (BrikByteOS v1)

This document defines the authoritative SemVer tagging policy for BrikByteOS Pipelines.

## v1 Rules (Non-negotiable defaults)
- Source of truth: **git tags only**
- Tag format: **strict** `vX.Y.Z` (example: `v1.2.3`)
- Pre-release tags like `v1.2.3-rc.1` are **disabled in v1** (reserved for v2+)
- “Latest tag” is computed by **SemVer max**, not by tag creation date

## Policy Location
Org default: `.github/policy.yml`

Optional override (v1 minimal overlay): `.github/policy.local.yml`

## Branch Wildcards
`release/*` matches:
- `release/v1`
- `release/2026-01`

## Enforcement Modes
- `warn`: emit warnings but continue
- `block`: fail the job/workflow

## Idempotency Modes
- `fail` (default): if tag exists → fail
- `noop`: if tag exists and points to same SHA → succeed; otherwise fail conflict
