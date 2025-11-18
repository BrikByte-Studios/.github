# Reviews & Approvals Policy (PIPE-GOV-7.3.1)

This document describes how **review requirements** are expressed in `policy.yml` and enforced by the **reviews gate**.

## 1. Structure in policy.yml

At the org level (`.github/policy.yml`):

```yaml
reviews:
  required_approvals: 2                # global baseline (non-relaxable)
  require_code_owner_review: true      # global baseline (non-relaxable)
  additional_reviewer_teams:
    - "platform-leads"

  default:
    required_approvals: 2
    require_code_owner_review: true
    required_roles: []                 # optional roles (GitHub team slugs)

  branches:
    main:
      required_approvals: 2
      require_code_owner_review: true

    "release/*":
      required_approvals: 2
      require_code_owner_review: true

    "hotfix/*":
      required_approvals: 2
      required_roles:
        - "platform-leads"

    "feature/*":
      required_approvals: 1
      require_code_owner_review: false
```

# Reviews & Approvals Policy (PIPE-GOV-7.3.1)

This document describes how **review requirements** are expressed in `policy.yml` and enforced by the **reviews gate**.

## 1. Structure in policy.yml

At the org level (`.github/policy.yml`):

```yaml
reviews:
  required_approvals: 2                # global baseline (non-relaxable)
  require_code_owner_review: true      # global baseline (non-relaxable)
  additional_reviewer_teams:
    - "platform-leads"

  default:
    required_approvals: 2
    require_code_owner_review: true
    required_roles: []                 # optional roles (GitHub team slugs)

  branches:
    main:
      required_approvals: 2
      require_code_owner_review: true

    "release/*":
      required_approvals: 2
      require_code_owner_review: true

    "hotfix/*":
      required_approvals: 2
      required_roles:
        - "platform-leads"

    "feature/*":
      required_approvals: 1
      require_code_owner_review: false
```

At the repo level (`policy.yml`), overrides inherit from org policy via `extends: org` and are merged by `policy-merge.js`.  
Org-level minimums (e.g. minimum approvals for `main` / `release/*`) are enforced by merge constraints and **cannot be relaxed**.

## 2. Branch selection logic
Given a PR with `base.ref = <branch>`:
1. If `reviews.branches` contains an exact key equal to `<branch>`, that rule is used.
2. Else, the first glob pattern key that matches (e.g. `release/*`, `feature/*`) is used.
3. Else, `reviews.default` is used if present.
4. Else, the flattened baseline `reviews.required_approvals` / `reviews.require_code_owner_review` is used.

This rule source is recorded as `reviews.rule_source` in `decision.json`.

## 3. Gate inputs
The reviews gate consumes two inputs:
- **Effective policy** — typically from:

```bash
node scripts/policy/policy-merge.js \
  --base .github/policy.yml \
  --repo policy.yml \
  --schema docs/policy/policy.schema.json \
  --out .audit/<run>/effective-policy.json
```
- **Review evidence** — from:

```bash
node scripts/policy/gather-reviews.mjs \
  --out .audit/<run>/reviews.json
```
Example `reviews.json`:

```json
{
  "branch": "main",
  "pr_number": 42,
  "approvals": [
    { "user": "alice", "teams": ["platform-leads"], "author_association": "MEMBER" },
    { "user": "bob", "teams": ["backend-team"], "author_association": "MEMBER" }
  ],
  "code_owner_approved": true
}
```
## 4. Evaluation rules
The evaluator (`scripts/policy/eval-reviews.mjs`) computes:
- `required_approvals`
- `require_code_owner_review`
- `required_roles` (if any) from the selected rule and compares them with evidence:

### 1. Approvals count

```text
actual_approvals >= required_approvals
```

### 2. Codeowners

If `require_code_owner_review: true`, there must be a `code_owner_approved === true` flag in evidence (approximate in v1).

### 3. Required roles / teams

If `required_roles` is non-empty, at least one approver must belong to one of those roles (GitHub team slugs).

Any failure sets:

```json
"reviews": {
  "branch": "main",
  "result": "fail",
  "reason": "Branch main requires 2 approvals; got 1.",
  ...
}
```
and exits non-zero, failing CI.

## 5. Example CI wiring
Inside a product repo:

```yaml
# .github/workflows/policy-reviews-gate.yml
name: Policy Reviews Gate

on:
  pull_request:
    types: [opened, synchronize, reopened]
    paths:
      - ".github/policy.yml"
      - "policy.yml"
      - ".github/workflows/**"

jobs:
  reviews-gate:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      # 1) Merge org + repo policy (if repo has policy.yml)
      - name: Merge policy (org + repo)
        run: >
          node scripts/policy/policy-merge.js
          --base .github/policy.yml
          --repo policy.yml
          --schema docs/policy/policy.schema.json
          --out .audit/policy/effective-policy.json

      # 2) Gather approvals from GitHub
      - name: Gather reviews evidence
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: >
          node scripts/policy/gather-reviews.mjs
          --out .audit/policy/reviews.json

      # 3) Evaluate gate
      - name: Evaluate reviews gate
        run: >
          node scripts/policy/eval-reviews.mjs
          --policy .audit/policy/effective-policy.json
          --reviews .audit/policy/reviews.json
          --decision .audit/policy/decision.json
```