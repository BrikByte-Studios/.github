# Architecture Decision Records (ADRs) — BrikByte Studios Governance

This directory defines the **canonical ADR conventions** for the BrikByte-Studios organization.  
Product and platform repos are expected to follow these conventions and reuse the centralized validation workflow.

---

## 1. What is an ADR?

An **Architecture Decision Record (ADR)** is a lightweight document that captures:

- A significant technical or architectural decision
- The context and trade-offs behind that decision
- The expected consequences, both positive and negative

ADRs give us a **traceable history of decisions** and make it easier to understand **why** the system looks the way it does.

---

## 2. File Naming & Location

- All ADRs live under: `docs/adr/`
- Each ADR file name must start with a **3-digit sequence**:

  ```text
  docs/adr/001-my-first-decision.md
  docs/adr/002-another-decision.md
  docs/adr/003-governance-policies.md
  ```

- The `seq` field in the front-matter must match the numeric prefix:
```yaml
seq: 1   # for 001-...
seq: 2   # for 002-...
```

- The **id** field is a stable, 4-digit identifier:
```yaml
id: "ADR-0001"
id: "ADR-0002"
```

---

## 3. Front-Matter Fields

Every ADR must start with YAML front-matter that matches `docs/adr/adr.schema.json`.

Required fields:
```yaml
id: "ADR-0001"             # Stable identifier (ADR-0001, ADR-0002, ...)
seq: 1                     # Integer; matches filename prefix (001-..., 002-..., etc.)
title: "Short decision name"
status: "Proposed"         # Proposed | Accepted | Superseded | Rejected | Deprecated
date: 2025-11-15           # YYYY-MM-DD (ISO 8601)
authors:
  - "@handle"              # One or more authors
area:
  - "PIPE"                 # One or more areas, e.g. PIPE, GOV, SEC, IAC
```

Optional fields:
```yaml
review_after: 2026-05-14   # Optional review date
rfc: "RFC-0007"            # Optional RFC reference
supersedes:
  - "ADR-0003"             # List of ADR IDs this ADR supersedes
superseded_by: null        # ADR ID that replaces this one, or null
links:
  - type: "doc"
    label: "Design Doc"
    url: "https://example.com/design-doc"
```

See the full schema in [docs/adr/adr.schema.json](./adr.schema.json)
.

---

## 4. Template

To create a new ADR, copy the canonical template:
```text
docs/adr/template.md  →  docs/adr/00X-some-title.md
```

Then:  
1. Increment the `seq` and filename prefix (001-, 002-, …).
2. Assign the next available `id` (e.g. `ADR-0003`).
3. Fill in the title, status, dates, authors, and content sections.

---

## 5. Centralized ADR Validation Workflow

BrikByte-Studios/.github exposes a **reusable GitHub Actions workflow** to validate ADRs:
```yaml
# In your product or platform repo: .github/workflows/adr-validate.yml
name: adr-validate

on:
  pull_request:
    paths: [ "docs/adr/**" ]

jobs:
  adr-validate:
    uses: BrikByte-Studios/.github/.github/workflows/adr-validate.yml@main
    with:
      adr_path: "docs/adr/[0-9][0-9][0-9]-*.md"
      generate_index: false
```
### What the workflow does
- Runs `scripts/adr/adr-lint.js` to:
    - Validate ADR front-matter against `docs/adr/adr.schema.json`
    - Check uniqueness of `id` and `seq`
    - Ensure filename prefix matches `seq`

- Optionally runs `scripts/adr/adr-index-generate.js` to:
    - Generate `docs/adr/000-index.md` (non-blocking in v1)

### Failure behavior
If an ADR is malformed:
- The workflow will fail.
- GitHub will show annotations on the PR, for example:  
    `Schema validation error in "docs/adr/003-bad-adr.md" at "status": must be equal to one of the allowed values`

You must fix the ADR before merging.

---

## 6. ADR Index

The index file:
```text
docs/adr/000-index.md
```

is **auto-generated** and contains:
- A **“By Status”** section with a table of ADRs grouped by status.
- A **“By Area”** section with a table of ADRs grouped by area.

Do not edit `000-index.md` manually.  
Run `node scripts/adr/adr-index-generate.js` locally, or enable `generate_index: true` in CI.

---

## 7. Migration & Adoption Guidance

For an existing repo:
1. Create `docs/adr/` if it doesn’t exist.
2. Copy:
    - `docs/adr/template.md` as a starting template.
    - (Optionally) `docs/adr/adr.schema.json` if you want local validation.
3. Add the `adr-validate` workflow as shown above.
4. Write or migrate your ADRs into `docs/adr/00X-*.md` using the template.

Once this is in place:
- Every PR touching `docs/adr/**` will automatically validate ADRs.
- Governance and compliance can rely on a consistent ADR structure across repos.