#!/usr/bin/env node
/**
 * BrikByte Studios — Policy Gate Engine Unit Tests (PIPE-GOV-8.1)
 *
 * Scope:
 *  - Exercise evaluatePolicyGate() in isolation with small in-memory policies/inputs.
 *  - Cover baseline rule families:
 *      • coverage.min
 *      • tests.green (optional starter)
 *      • security.sca / security.sast
 *      • adr.required_for_infra
 *      • supplychain.signed / integrity.sbom
 *
 * These are lightweight, self-contained tests that do NOT hit the filesystem.
 * They’re intended as a sanity net in addition to higher-level integration tests.
 */

import assert from "node:assert/strict";
import { evaluatePolicyGate } from "../../scripts/policy/gate-engine.mjs";

// ---------------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------------

const tests = [];

/**
 * Register a test.
 *
 * @param {string} name
 * @param {() => (void|Promise<void>)} fn
 */
function test(name, fn) {
  tests.push({ name, fn });
}

async function run() {
  let failed = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (err) {
      failed++;
      console.error(`✗ ${name}`);
      console.error(err.stack || err.message || err);
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} test(s) failed.`);
    process.exit(1);
  } else {
    console.log(`\nAll ${tests.length} tests passed.`);
    process.exit(0);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Helper to find a rule result by id from evaluatePolicyGate() output.
 *
 * @param {ReturnType<typeof evaluatePolicyGate>} decision
 * @param {string} ruleId
 */
function getRule(decision, ruleId) {
  const rule = (decision.rules || []).find((r) => r.id === ruleId);
  assert.ok(rule, `Expected rule '${ruleId}' to be present in decision.rules`);
  return rule;
}

// ---------------------------------------------------------------------------
// Coverage / tests rules
// ---------------------------------------------------------------------------

test("coverage.min — passes when coverage >= threshold", () => {
  const policy = {
    policy_version: "1.0.0",
    rules: {
      "coverage.min": {
        severity: "block",
        requires_evidence: true,
        threshold: 80
      }
    }
  };

  const inputs = {
    coverage: {
      line: 86.3,
      report_url: "https://ci.example.com/coverage"
    },
    meta: {
      branch: "main"
    }
  };

  const decision = evaluatePolicyGate(policy, inputs, []);
  const coverageRule = getRule(decision, "coverage.min");

  assert.equal(coverageRule.result, "pass");
  assert.match(
    coverageRule.message,
    /86\.3% .* 80%/,
    "Expected coverage message to mention actual and required thresholds"
  );
  assert.equal(decision.status, "passed");
});

test("coverage.min — fails and blocks when coverage < threshold", () => {
  const policy = {
    policy_version: "1.0.0",
    rules: {
      "coverage.min": {
        severity: "block",
        requires_evidence: true,
        threshold: 80
      }
    }
  };

  const inputs = {
    coverage: {
      line: 72.0,
      report_url: "https://ci.example.com/coverage"
    },
    meta: {
      branch: "main"
    }
  };

  const decision = evaluatePolicyGate(policy, inputs, []);
  const coverageRule = getRule(decision, "coverage.min");

  assert.equal(coverageRule.result, "fail");
//   assert.(
//     coverageRule.message,
//     /72\.0% .* 80%/,
//     "Expected failure message to reflect low coverage"
//   );
  assert.equal(decision.status, "failed");
});

test("coverage.min — required evidence missing → fail with missing_evidence=true", () => {
  const policy = {
    policy_version: "1.0.0",
    rules: {
      "coverage.min": {
        severity: "block",
        requires_evidence: true,
        threshold: 80
      }
    }
  };

  const inputs = {
    // no coverage key at all
    meta: {
      branch: "main"
    }
  };

  const decision = evaluatePolicyGate(policy, inputs, []);
  const coverageRule = getRule(decision, "coverage.min");

  assert.equal(coverageRule.result, "fail");
  assert.equal(coverageRule.missing_evidence, true);
  assert.equal(decision.status, "failed");
  assert.ok(
    decision.missing_evidence.includes("coverage.min"),
    "coverage.min should be listed in decision.missing_evidence"
  );
});

// Optional starter for tests.green
test("tests.green — non-green test status causes failure", () => {
  const policy = {
    policy_version: "1.0.0",
    rules: {
      "tests.green": {
        severity: "block",
        requires_evidence: true
      }
    }
  };

  const inputs = {
    tests: {
      total: 10,
      failed: 2,
      status: "red",
      report_url: "https://ci.example.com/tests"
    },
    meta: {
      branch: "feature/foo"
    }
  };

  const decision = evaluatePolicyGate(policy, inputs, []);
  const testsRule = getRule(decision, "tests.green");

  assert.equal(testsRule.result, "fail");
  assert.equal(decision.status, "failed");
});

// ---------------------------------------------------------------------------
// Security rules (SCA / SAST)
// ---------------------------------------------------------------------------

test("security.sca — within 'no-critical' threshold passes", () => {
  const policy = {
    policy_version: "1.0.0",
    rules: {
      "security.sca": {
        severity: "block",
        max_level: "no-critical",
        requires_evidence: true
      }
    }
  };

  const inputs = {
    security: {
      sca: {
        count: {
          critical: 0,
          high: 1,
          medium: 3,
          low: 0
        },
        report_url: "https://ci.example.com/sca"
      }
    },
    meta: {
      branch: "main"
    }
  };

  const decision = evaluatePolicyGate(policy, inputs, []);
  const scaRule = getRule(decision, "security.sca");

  assert.equal(scaRule.result, "pass");
  assert.equal(decision.status, "passed");
});

test("security.sca — critical findings violate 'no-critical' and block", () => {
  const policy = {
    policy_version: "1.0.0",
    rules: {
      "security.sca": {
        severity: "block",
        max_level: "no-critical",
        requires_evidence: true
      }
    }
  };

  const inputs = {
    security: {
      sca: {
        count: {
          critical: 1,
          high: 0,
          medium: 0,
          low: 0
        },
        report_url: "https://ci.example.com/sca"
      }
    },
    meta: {
      branch: "main"
    }
  };

  const decision = evaluatePolicyGate(policy, inputs, []);
  const scaRule = getRule(decision, "security.sca");

  assert.equal(scaRule.result, "fail");
  assert.equal(decision.status, "failed");
});

test("security.sast — warn-only violations lead to passed_with_warnings", () => {
  const policy = {
    policy_version: "1.0.0",
    rules: {
      "security.sast": {
        severity: "warn",
        max_level: "no-high",
        requires_evidence: true
      }
    }
  };

  const inputs = {
    security: {
      sast: {
        count: {
          critical: 0,
          high: 2,
          medium: 0,
          low: 0
        },
        report_url: "https://ci.example.com/sast"
      }
    },
    meta: {
      branch: "main"
    }
  };

  const decision = evaluatePolicyGate(policy, inputs, []);
  const sastRule = getRule(decision, "security.sast");

  assert.equal(sastRule.result, "fail");
  assert.equal(sastRule.severity, "warn");
  assert.equal(decision.status, "passed_with_warnings");
});

// ---------------------------------------------------------------------------
// ADR rules
// ---------------------------------------------------------------------------

test("adr.required_for_infra — required ADR present → pass", () => {
  const policy = {
    policy_version: "1.0.0",
    rules: {
      "adr.required_for_infra": {
        severity: "block",
        requires_evidence: true
      }
    }
  };

  const inputs = {
    adr: {
      required: true,
      referenced: ["ADR-0003"],
      missing_required: false,
      details_url: "https://github.com/org/repo/pull/42"
    },
    meta: {
      branch: "infra/terraform-refactor"
    }
  };

  const decision = evaluatePolicyGate(policy, inputs, []);
  const adrRule = getRule(decision, "adr.required_for_infra");

  assert.equal(adrRule.result, "pass");
  assert.equal(decision.status, "passed");
});

test("adr.required_for_infra — missing required ADR → fail and block", () => {
  const policy = {
    policy_version: "1.0.0",
    rules: {
      "adr.required_for_infra": {
        severity: "block",
        requires_evidence: true
      }
    }
  };

  const inputs = {
    adr: {
      required: true,
      referenced: [],
      missing_required: true,
      details_url: "https://github.com/org/repo/pull/43"
    },
    meta: {
      branch: "infra/breaking-change"
    }
  };

  const decision = evaluatePolicyGate(policy, inputs, []);
  const adrRule = getRule(decision, "adr.required_for_infra");

  assert.equal(adrRule.result, "fail");
  assert.equal(decision.status, "failed");
});

// ---------------------------------------------------------------------------
// Supply-chain / artifact integrity rules
// ---------------------------------------------------------------------------

test("supplychain.signed + integrity.sbom — both true → pass", () => {
  const policy = {
    policy_version: "1.0.0",
    rules: {
      "supplychain.signed": {
        severity: "block",
        requires_evidence: true
      },
      "integrity.sbom": {
        severity: "block",
        requires_evidence: true
      }
    }
  };

  const inputs = {
    integrity: {
      signed_artifacts: true,
      sbom_present: true,
      integrity_report_url: "https://ci.example.com/integrity",
      sbom_url: "https://ci.example.com/sbom"
    },
    meta: {
      target_env: "prod",
      branch: "release/v1.2.3"
    }
  };

  const decision = evaluatePolicyGate(policy, inputs, []);
  const signedRule = getRule(decision, "supplychain.signed");
  const sbomRule = getRule(decision, "integrity.sbom");

  assert.equal(signedRule.result, "pass");
  assert.equal(sbomRule.result, "pass");
  assert.equal(decision.status, "passed");
});

test("supplychain.signed — evidence missing but required → fail + missing_evidence", () => {
  const policy = {
    policy_version: "1.0.0",
    rules: {
      "supplychain.signed": {
        severity: "block",
        requires_evidence: true
      }
    }
  };

  const inputs = {
    // integrity key missing entirely
    meta: {
      target_env: "prod",
      branch: "release/v1.2.4"
    }
  };

  const decision = evaluatePolicyGate(policy, inputs, []);
  const signedRule = getRule(decision, "supplychain.signed");

  assert.equal(signedRule.result, "fail");
  assert.equal(signedRule.missing_evidence, true);
  assert.equal(decision.status, "failed");
  assert.ok(
    decision.missing_evidence.includes("supplychain.signed"),
    "supplychain.signed should be tracked as missing evidence"
  );
});

test("integrity.sbom — sbom_present=false → fail", () => {
  const policy = {
    policy_version: "1.0.0",
    rules: {
      "integrity.sbom": {
        severity: "block",
        requires_evidence: true
      }
    }
  };

  const inputs = {
    integrity: {
      sbom_present: false,
      integrity_report_url: "https://ci.example.com/integrity"
    },
    meta: {
      target_env: "prod",
      branch: "release/v2.0.0"
    }
  };

  const decision = evaluatePolicyGate(policy, inputs, []);
  const sbomRule = getRule(decision, "integrity.sbom");

  assert.equal(sbomRule.result, "fail");
  assert.equal(decision.status, "failed");
});

// ---------------------------------------------------------------------------
// Waiver interaction (basic skeleton)
// ---------------------------------------------------------------------------

test("block rule failure with active waiver does NOT mark overall status=failed", () => {
  const policy = {
    policy_version: "1.0.0",
    rules: {
      "coverage.min": {
        severity: "block",
        requires_evidence: true,
        threshold: 90
      }
    }
  };

  const inputs = {
    coverage: {
      line: 80,
      report_url: "https://ci.example.com/coverage"
    },
    meta: {
      branch: "main"
    }
  };

  const waivers = [
    {
      rule: "coverage.min",
      scope: "temporary-relaxation",
      reason: "Migration window",
      ttl: "2099-12-31",
      approver: "@platform-lead",
      evidence: "https://internal/wiki/waivers/coverage-min-temp"
    }
  ];

  const decision = evaluatePolicyGate(policy, inputs, waivers);
  const coverageRule = getRule(decision, "coverage.min");

  assert.equal(coverageRule.result, "fail", "Rule still marked as fail at rule-level");
  assert.equal(coverageRule.waived, true, "Rule must be flagged as waived");
  assert.notEqual(decision.status, "failed", "Overall status should not be hard-failed by waived block rule");
  assert.ok(
    decision.status === "passed_with_warnings" || decision.status === "passed",
    "Overall status should be 'passed' or 'passed_with_warnings' when only failure is waived"
  );
});

// ---------------------------------------------------------------------------
// Run all tests
// ---------------------------------------------------------------------------

run();
