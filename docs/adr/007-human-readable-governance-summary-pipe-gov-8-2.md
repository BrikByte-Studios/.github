---
id: "ADR-0007"                # e.g. ADR-0003 (4-digit padded)
seq: 7                        # integer, matches filename prefix
title: "Human-Readable Governance Summary (PIPE-GOV-8.2)"
status: "Accepted"            # Proposed | Accepted | Superseded | Rejected | Deprecated
date: 2025-11-22              # YYYY-MM-DD
review_after: 2026-01-15

authors:
  - "@BrikByte-Studios/platform-leads"

area:
  - "governance"
  - "policy-gate"
  - "ci-cd"
  - "devx"

rfc: null                     # Optional, e.g. "RFC-0007"

supersedes: []                # ADR IDs superseded by this one
superseded_by: null           # ADR that replaces this one

links:
  - type: "doc"
    label: "Design doc"
    url: "https://example.com/design-doc"
---

# Human-Readable Governance Summary (PIPE-GOV-8.2)

## Status

- **Status:** Accepted
- **Date:** 2025-11-22
- **Review After:** 2026-01-15
- **Authors:** @BrikByte-Studios/platform-leads
- **Area:** governance, policy-gate, ci-cd, devx
- **Supersedes:** none
- **Superseded By:** none

---

## 1. Context

## 1. Context

BrikByte’s governance model (PIPE-GOV-7.x / 8.x) centralizes policy evaluation in a single **policy gate** (PIPE-GOV-8.1). The gate produces a machine-readable `decision.json` that aggregates:

- Test and coverage signals  
- Security findings (SCA/SAST, etc.)  
- ADR / architecture governance results  
- Supply chain / artifact integrity checks  
- Metadata (branch, target environment, PR number, etc.)

While this artifact is ideal for machines and dashboards, it is **not developer-friendly** in its raw form:

- Developers typically only see **red CI jobs** and terse failure messages.  
- It is not obvious **which rule** failed (e.g., `coverage.min`, `security.sca`, `adr.required_for_infra`, `supplychain.signed`).  
- It is not obvious whether a failure was **hard**, **warn-only**, or **waived**.  
- There is no standardized place to see **“what should I do next?”**.

Historical pain points:

- PR authors ask “*Why did the governance gate fail?*” and need to dig into logs.  
- Reviewers must reconstruct context by hopping between jobs, artifacts and tools.  
- Governance rules can be perceived as “random CI red” instead of an intentional policy.

We need a **single, human-readable summary** that:

- Is **derived only from `decision.json`** (single source of truth; gate remains the only evaluator).  
- Presents **overall status, per-rule results, waivers, and recommended actions** in a compact, predictable format.  
- Surfaces this summary **directly on the PR** (sticky comment) and in **CI logs**.

This ADR defines that summary layer and how it integrates with the existing policy gate pipeline.

---

## 2. Decision

We will implement a **human-readable governance summary** on top of `decision.json` using:

1. A **Node-based summary generator**: `scripts/policy/summary.mjs`  
   - CLI interface:  
     - `--decision <path>` (input `decision.json`, required)  
     - `--out <path>` (output `summary.md`, optional, default `out/summary.md`)  
   - Responsibilities:  
     - Read `decision.json` from PIPE-GOV-8.1.  
     - Render a **canonical Markdown summary** with:
       - Overall status header (emoji + status + env + branch + score + policy_version).  
       - **Rule Results** table (one row per rule).  
       - **Recommended Fixes** section for failing / serious warning rules.  
       - **Evidence & Links** section (decision path, coverage URL, security reports, etc.).  
     - Write the summary to `out/summary.md`.  
     - Print the same Markdown to stdout so it is visible in CI logs.

2. A **sticky PR comment updater**: `scripts/policy/comment.mjs`  
   - CLI usage in workflow: `node scripts/policy/comment.mjs out/summary.md`.  
   - Uses `GITHUB_TOKEN` to:
     - Find an existing comment starting with `## Governance Summary (policy-gate)` on the PR.  
     - Update that comment in-place if it exists.  
     - Otherwise create a new comment.  
   - Ensures there is only **one canonical governance comment per PR**.

3. A **standard summary format**, for both logs and PR comment:

   ```md
   ## Governance Summary (policy-gate)

   **Overall Status:** ✅ Passed / ⚠️ Passed with Warnings / ❌ Failed  
   **Policy Version:** vX.Y.Z  
   **Target Env:** staging • **Branch:** feature/payments • **Score:** 87/100

   ---

   ### Rule Results

   | Rule ID          | Severity | Result   | Waived | Details                          |
   |------------------|----------|----------|--------|----------------------------------|
   | tests.green      | block    | ✅ Pass  | ❌ No  | 124/124 tests green              |
   | coverage.min     | block    | ⚠️ Warn  | ✅ Yes | 78% (waived until 2025-12-31)    |
   | security.sca     | block    | ❌ Fail  | ❌ No  | Critical CVE-2025-XXXX detected. |

   ### Recommended Fixes

   1. **coverage.min** — Increase coverage to ≥80% by adding tests to critical flows in `payments/*`.
   2. **security.sca** — Upgrade `libX` to `>=2.3.4` to remediate CVE-2025-XXXX; see dependency board.

   ### Evidence & Links

   - Decision JSON: `.audit/2025-11-20/PIPE-GOV-8.1/decision.json`
   - Coverage: https://ci/.../coverage
   - Security report: https://ci/.../sca
   ``` 
4. **Workflow integration** into the policy gate job:
    - After `policy-gate` (PIPE-GOV-8.1) writes `out/decision.json`, we add:
    ```yaml
    - name: Render governance summary
      if: always()
      run: node scripts/policy/summary.mjs --decision out/decision.json --out out/summary.md

    - name: Post PR governance summary
      if: always() && github.event_name == 'pull_request'
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      run: node scripts/policy/comment.mjs out/summary.md
    ```
    - Both steps use `if: always()` so the summary / comment runs **even when the gate fails**, preserving the “why” for the developer.

Key properties of this decision:
- The **policy gate remains the only evaluator** of governance rules.
  - The summary does not re-interpret policy; it only renders `decision.json`.
- The summary is **format-stable** and documented in `docs/governance/policy-gates.md`.
- The PR comment is **sticky and updated**, not spammy (no duplicate comments per run).
---

## 3. Alternatives Considered



### 3.1 Option A — Logs-Only Summary Embedded in Gate Engine
Render a human-readable summary directly from the gate engine (`gate-engine.mjs`) and **only** print it to CI logs (no separate summary script, no PR comment).  
**Pros:**  
- Simplest implementation (all-in-one script).
- No additional scripts or workflow steps.
- No need for GitHub API integration.

**Cons:**  
- Summary is buried in logs; developers still have to scroll/search.
- No persistent, canonical location on the PR.
- Harder to evolve the summary format independently of gate logic.
- No obvious place to link evidence for stakeholders outside CI.

**Why Rejected:**  
- Does not materially improve the **developer experience** or onboarding for governance.
- Tightly couples UX concerns to the gate engine, reducing modularity and testability.

---

### 3.2 Option B — GitHub Checks API Rich UI (No Comments)
Use the GitHub Checks API to render a dedicated **Checks “Details”** page with a custom UI (markdown/HTML), but **no PR comments**.  
**Pros:**  
- Richer UI possibilities (sections, collapsible groups, icons).
- Lives under the Checks tab tied directly to the gate job.
- No comment noise on the PR.

**Cons:**  
- More complex: requires a dedicated integration or GitHub App.
- Harder for developers to discover versus a visible comment on the PR timeline.
- Heavier maintenance cost and authentication complexity.
- Overkill for the initial governance rollout.

**Why Rejected:**  
- Higher implementation and operational complexity for relatively small UX gain compared to Markdown + sticky comment.
- Slows down adoption; we prefer a simpler pattern first, with Checks API a potential future enhancement.

---

### 3.3 Option C — External Dashboard Only
Ship `decision.json` to an external dashboard (e.g., internal governance UI) and instruct devs to check that dashboard for explanations.  
**Pros:**  
- Very flexible UI, can combine multiple repos and runs.
- Good for compliance and management views.

**Cons:**  
- Requires **leaving GitHub** to understand why a PR failed.
- Adds friction and latency for everyday developer workflows.
- Requires additional infrastructure (storage, auth, hosting).
- Does not solve the “right here, right now on the PR” UX problem.

**Why Rejected:**  
- Solves management/compliance visibility but not day-to-day developer UX.
- Higher infra/ops cost than a simple Markdown summary.

---

### 3.4 **Option D — Markdown Summary + Sticky PR Comment (✔ Chosen)**
Implement a separate summary generator that renders Markdown from `decision.json` and posts it as a **sticky PR comment**, while also printing it to logs.  
**Pros:**  
- Simple, low-dependency implementation (pure Node + GitHub REST API).
- **Inline with developer workflow**: visible on the PR itself.
- Uses GitHub-flavored Markdown, easy to extend and style.
- Decouples gate logic (evaluation) from UX (summary rendering).
- Works for both PR and non-PR pipelines (logs only in the latter).
- Naturally supports audit (summary is part of PR history and CI logs). 

**Cons / Trade-offs:**  
- Adds two extra steps to the gate workflow.
- Requires careful handling to avoid duplicate comments.
- Some teams may prefer Checks UI over comments in the future.  

**Why Accepted:**  
- Best balance between **developer experience, governance clarity**, and **implementation complexity**.
- Easy to iterate and extend (e.g., remediation hints, more rule types).
- Can coexist with future Checks / dashboard integrations without breaking compatibility.

---

## 4. Consequences

### Positive
- **Developer clarity:**
  - Developers see **exactly which rules** passed, warned, or failed.
  - Waivers and missing evidence are visible and understandable.

- **Actionable remediation:**
  - Recommended Fixes section forces us to attach “**what to do next**” to governance rules.
  - Encourages rule owners to provide `remediation_hint` in `decision.json` or in a rule-hint map.

- **Standardization:**
  - A single, documented Markdown format across all repos.
  - Easier to train newcomers on “how to read governance results”.

- **Auditability:**
  - Summary is part of PR history and CI logs.
  - Can be copied into tickets, post-mortems, or governance reviews.

- **Separation of concerns:**
  - Gate engine focuses on evaluation and scoring.
  - Summary focuses on **communication and UX**, consuming only `decision.json`.

### Negative / Risks
- **Risk: Drift between gate and summary expectations.**
  - If `decision.json` schema evolves and summary is not updated, some rules may render poorly or be omitted.
- **Risk: Comment noise or duplication**.
  - Bugs in `comment.mjs` could post multiple comments instead of updating the existing one.
- **Risk: Extra CI step failures.**
  - If summary or comment scripts fail, they could affect overall perception of the gate (even if the gate itself worked).
- **Risk: Over-simplified messaging.**
  - Poorly written or generic remediation hints may frustrate developers instead of helping them.

### Mitigations
- **Schema-awareness & tests:**
  - Snapshot / golden-file tests for `scripts/policy/summary.mjs` based on fixture `decision.json` files.
  - Part of the governance test suite (`npm run gate:test` / similar).

- **Sticky comment logic:**
  - `comment.mjs` searches for comments starting with `## Governance Summary (policy-gate)` and updates the first match.
  - Tests for “update vs create” logic before rollout to a wide set of repos.

- **Failure isolation:**
  - Summary + comment steps use `if: always()`.
  - Policy gate remains the **source of truth**; summary failures should not change actual pass/fail semantics.

- **Documentation & examples:**
  - `docs/governance/policy-gates.md` documents the summary format with real examples for:
    - Full pass
    - Pass with warnings
    - Hard fail with waivers and missing evidence  

---

## 5. Implementation Notes

- **Files / Modules:**
  - `scripts/policy/summary.mjs`
    - Implements:
      - CLI arg parsing (`--decision`, `--out`).
      - Loading and parsing `decision.json`.
      - Mapping:
        - `status` → emoji (`✅`/`⚠️`/`❌`)
        - `rules[].result` → user-friendly Result column (`✅ Pass`, `⚠️ Warn`, `❌ Fail`).
        - `rules[].waived` → `✅ Yes` / `❌ No`.
      - Building Markdown sections:
        1. Header (`## Governance Summary (policy-gate)` + status line).
        2. Rule Results table.
        3. Recommended Fixes.
        4. Evidence & Links.
      - Priority for remediation text:
        - Use `rule.remediation_hint` if present.
        - Else fallback to a small internal map keyed by `rule.id`.
      - Writes `out/summary.md` and prints the same string to stdout.
  - `scripts/policy/comment.mjs`
    - Reads `summary.md` path from argv.
    - Uses `GITHUB_TOKEN` and `GITHUB_REPOSITORY`, `GITHUB_PR`/event payload:
      - List PR comments.
      - Find comment starting with `## Governance Summary (policy-gate)`.
      - Update body or create a new comment.
- **Workflow Integration:**
  - Summary + comment runs in the **same job** that runs the gate engine so they share `out/decision.json`.
  - For non-PR events:
    - Only `summary.mjs` is run; `comment.mjs` is skipped by `if: github.event_name == 'pull_request'`.
- **Future Extensions (non-blocking for this ADR):**
  - Optional `scripts/policy/summary-html.mjs` to generate `out/summary.html` from `summary.md` for artifact upload.
  - Integration with GitHub Checks API using the same Markdown.
  - Richer remediation hints that can include code owners, teams, or links to internal playbooks.
- **Ownership:**
  - Platform / governance team owns:
    - Summary format.
    - Summary + comment scripts.
    - Documentation and examples.
  - Product teams consume:
    - The summary as read-only UX; they do not fork the format per repo.

---

## 6. References

- PIPE-GOV-7.1 — Policy schema and effective policy generation.
- PIPE-GOV-7.2 — Policy overrides and `extends:` semantics.
- PIPE-GOV-7.3.x — Individual gate designs (reviews, coverage, security, ADR, artifacts).
- PIPE-GOV-8.1 — Aggregated Governance Decision Job (decision.json contract).
- GitHub Actions docs — workflow commands and REST API for PR comments.
- `docs/governance/policy-gates.md` — Policy gate & summary user-facing documentation.
