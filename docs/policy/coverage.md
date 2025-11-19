# Coverage Governance (PIPE-GOV-7.3.2)

This document defines how **minimum test coverage** is governed at BrikByte Studios via `.github/policy.yml` and enforced in CI by the coverage policy gate.

---

## 1. Policy Fields

Coverage-related fields live under the `tests` section of `policy.yml`:

```yaml
tests:
  coverage_min: 80              # absolute minimum overall coverage (%)
  coverage_delta_min: -2        # allowed drop vs baseline (percentage points)
  coverage_report_path: "coverage/coverage-summary.json"
  require_tests_green: true
  critical_paths_only: false
```

### 1.1 `coverage_min` (required)
- **Type:** number (0–100)
- **Meaning:** Absolute minimum overall coverage percentage.
- **Org baseline:** The org-level `coverage_min` is **non-relaxable**:
    - Repos **may not** set a lower value via overrides.
    - Repos **may** tighten it (e.g., 85 or 90).

### 1.2 `coverage_delta_min` (optional)
- **Type:** number (percentage points, can be negative)
- **Meaning:** Minimum allowed coverage delta vs baseline:
    - Example: `-2` means coverage may drop by at most 2 percentage points.
    - If `coverage_baseline = 90` and `coverage_current = 86`:
      - Delta = `86 − 90 = -4` → violates `coverage_delta_min: -2` → fail.

If `coverage_delta_min` is omitted or baseline is unavailable, delta checks are skipped and only the absolute threshold is enforced.

### 1.3 `coverage_report_path` (optional but recommended)
- **Type:** string (path)
- **Meaning:** Where CI writes the coverage summary JSON file relative to repo root.
- **Default pattern:** `coverage/coverage-summary.json` (Jest/Istanbul-style).

The gate expects a structure like:
```jsonc
{
  "total": {
    "lines": { "pct": 82.35 },
    "statements": { "pct": 81.0 },
    "branches": { "pct": 75.0 },
    "functions": { "pct": 80.0 }
  }
}
```

The gate will try (in order):

1. `total.lines.pct`
2. `total.branches.pct`
3. `total.statements.pct`
4. `total.functions.pct`

---

## 2. Enforcement Semantics
### 2.1 Absolute Coverage

Given:
- Org policy: `tests.coverage_min = 80`
- Repo policy: `tests.coverage_min = 85`
- Current coverage: `82`

Then:
- Effective minimum = `max(80, 85) = 85`
- Result: fail (82 < 85)
- Message:

    `Coverage 82% below minimum 85%.`

### 2.2 Delta Coverage

Given:
- `coverage_delta_min = -2`
- Baseline coverage: `90`
- New coverage: `86`

Then:

- Delta = `86 − 90 = -4`
- Delta < `-2` → fail
- Message (example):

Coverage delta -4.00pp below allowed minimum delta -2pp (current 86%, baseline 90%).

If:
- Baseline = 90, current = 89, delta_min = -2

Then:
- Delta = -1 ≥ -2 → **pass**

### 2.3 Non-Relaxable Org Baseline

Org baseline acts as a **floor**:
- If org `coverage_min = 80` and repo sets `70`:
  - Merge / validation fails: repo may not weaken the baseline.
- If repo sets `90`:
  - Effective minimum ≥ 90.

---

## 3. Gate Behaviour

The coverage gate:
1. Reads **org policy** and **effective merged policy**.
2. Reads coverage summary JSON from `tests.coverage_report_path` (or CLI override).
3. Optionally reads a baseline coverage summary (if configured).
4. Applies:
    - Absolute check vs `coverage_min`.
    - Optional delta check vs `coverage_delta_min` if baseline is available.
5. Writes a `coverage` block into `decision.json`, e.g.:
```json
{
  "coverage": {
    "coverage_current": 75.0,
    "coverage_baseline": 90.0,
    "coverage_min": 80.0,
    "coverage_delta_min": -2.0,
    "delta": -15.0,
    "coverage_report_path": "coverage/coverage-summary.json",
    "result": "fail",
    "reason": "Coverage 75% below minimum 80%."
  }
}
```
6. Exits with:
- `0` on pass.
- Non-zero on fail (blocking CI if policy mode is enforce).

---

## 4. Recommended Practices
### 4.1 For Libraries / Core Services
- Start with:
    - `coverage_min: 80–90`
    - `coverage_delta_min: -1` or `0` (no regressions)
- Ensure coverage summary is generated on every PR into protected branches.

### 4.2 For Prototypes / Experimental Repos
- You may:
    - Keep `coverage_min` lower (but not below org baseline).
    - Omit `coverage_delta_min` initially.
- Still generate coverage reports so you can tighten rules later.

### 4.3 Anti-Patterns
- **Don’t** turn off coverage gate by pointing `coverage_report_path` to a dummy file.
- **Don’t** weaken coverage below org baseline via overrides (CI will block this).
- **Don’t** rely only on coverage % for test quality; combine with:
    - Critical-path tests
    - Integration/E2E checks    
    - Manual exploratory testing

---

## 5. Wiring in CI

Example job snippet (GitHub Actions):
```yaml
- name: Run tests with coverage
  run: npm test -- --coverage

- name: Coverage Gate
  run: >
    node scripts/policy/coverage-gate.js
    --org-policy .github/policy.yml
    --effective-policy out/effective-policy.json
    --coverage-report coverage/coverage-summary.json
    --decision-in .audit/decision.json
    --decision-out .audit/decision.json
```

This will ensure coverage decisions become part of the audit trail under `.audit/`.