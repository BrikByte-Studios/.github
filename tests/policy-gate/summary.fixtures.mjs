// 🔹 Fixture 1: all rules pass, no waivers, happy path
export const decisionAllPass = {
  status: 'passed',
  score: 100,
  policy_version: '1.0.0',
  meta: {
    target_env: 'staging',
    branch: 'feature/awesome',
  },
  rules: [
    {
      id: 'tests.green',
      severity: 'block',
      result: 'pass',
      waived: false,
      message: '124/124 tests green',
      evidence: 'https://ci.example.com/run/123/tests',
    },
    {
      id: 'coverage.min',
      severity: 'block',
      result: 'pass',
      waived: false,
      message: 'Coverage 86% (min 80%)',
      evidence: 'https://ci.example.com/run/123/coverage',
    },
  ],
  waivers_used: [],
  missing_evidence: [],
};

// This snapshot is aligned with the *actual* output you pasted
export const expectedAllPassMarkdown = `
## Governance Summary (policy-gate)

**Overall Status:** ✅ Passed
**Policy Version:** v1.0.0
**Target Env:** staging • **Branch:** feature/awesome • **Score:** 100/100

---

### Rule Results

| Rule ID | Severity | Result | Waived | Details |
|---------|----------|--------|--------|---------|
| tests.green | block | ✅ Pass | ❌ No | 124/124 tests green 🔗 |
| coverage.min | block | ✅ Pass | ❌ No | Coverage 86% (min 80%) 🔗 |

### Recommended Fixes

No action required — all governance rules passed.

### Evidence & Links

- tests.green: https://ci.example.com/run/123/tests
- coverage.min: https://ci.example.com/run/123/coverage
`.trim();

// 🔹 Fixture 2: warn + fail, waiver + recommended fixes
export const decisionWarnFail = {
  status: 'passed_with_warnings',
  score: 87,
  policy_version: '1.1.0',
  meta: {
    target_env: 'prod',
    branch: 'hotfix/payment-retry',
  },
  rules: [
    {
      id: 'tests.green',
      severity: 'block',
      result: 'pass',
      waived: false,
      message: '98/98 tests green',
      evidence: 'https://ci.example.com/run/456/tests',
    },
    {
      id: 'coverage.min',
      severity: 'block',
      result: 'warn',
      waived: true,
      message:
        'Coverage 78% below required 80%, waiver WVR-2025-001 active until 2025-12-31',
      evidence: 'https://ci.example.com/run/456/coverage',
      remediation_hint:
        'Increase tests on payment retry and error paths until coverage ≥ 80%.',
    },
    {
      id: 'security.sca',
      severity: 'block',
      result: 'fail',
      waived: false,
      message: 'Critical CVE-2025-XXXX in libX 1.2.3',
      evidence: 'https://ci.example.com/run/456/sca',
      remediation_hint:
        'Upgrade libX to ≥ 1.2.4 or apply vendor patch to remove CVE-2025-XXXX.',
    },
  ],
  waivers_used: [
    {
      id: 'WVR-2025-001',
      rule: 'coverage.min',
      ttl: '2025-12-31T23:59:59+02:00',
      approver: '@platform-lead',
    },
  ],
  missing_evidence: [],
};

// 🔹 Fixture 3: missing evidence case
export const decisionMissingEvidence = {
  status: 'failed',
  score: 40,
  policy_version: '1.0.0',
  meta: {
    target_env: 'prod',
    branch: 'release/2025.11.01',
  },
  rules: [
    {
      id: 'tests.green',
      severity: 'block',
      result: 'pass',
      waived: false,
      message: '210/210 tests green',
      evidence: null,
    },
    {
      id: 'coverage.min',
      severity: 'block',
      result: 'fail',
      waived: false,
      message: 'Coverage report missing for this run',
      evidence: null,
      remediation_hint:
        'Ensure coverage job publishes report artifact before gate.',
    },
  ],
  waivers_used: [],
  missing_evidence: [
    {
      id: 'coverage.min',
      type: 'coverage',
      message: 'Coverage artifact not found in CI run 789',
    },
  ],
};
