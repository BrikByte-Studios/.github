# REP-GOV-002 — Templates, Labels, Dependabot (Std + Compliance)

## What this provides
- **Issue forms** + **PR template** (uniform intake)
- **Labels** taxonomy (colors/semantics) with idempotent seeding
- **Dependabot weekly** for npm, docker, GitHub Actions
- **Nightly compliance** + **evidence PR** (JSON + hashes)
- **SoD** via CODEOWNERS for all `.github/*` governance files

## How to adopt
1. Copy wrappers from `/samples` into your repo’s `.github/workflows/`.
2. Copy `.github/labels.yml`, `.github/ISSUE_TEMPLATE/*`, `pull_request_template.md`, `dependabot.yml`.
3. Add CODEOWNERS snippet (requires `@brikbyte/platform-core`).
4. Run **Actions → labels-seed** once.
5. Run **Actions → compliance** once; expect an audit PR.

## Auto-merge policy (dependabot)
- Only **dev deps** or **`semver:patch`** labeled PRs.
- Requires all required checks green.
- Add label manually or via rules to opt-in.

## Evidence pack
- Path: `/.audit/YYYY-MM-DD/`
- Files: `labels.json`, `issue_templates.txt`, `dependabot.yml.sha256`
- Generated nightly + on manual runs, pushed as an **audit PR**.

## Troubleshooting
- Missing approvals on `.github/*`: add CODEOWNERS snippet.
- `yq` not found: governance workflows install `pip yq`.
- GH API failures: confirm `ADMIN_TOKEN` has `repo` + `workflow`.
