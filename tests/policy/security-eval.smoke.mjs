#!/usr/bin/env node
/**
 * BrikByte Studios — Security Eval Smoke Tests (PIPE-GOV-7.3.3)
 *
 * Tiny smoke tests for evaluateSecurity():
 *  1) SAST: high severity above max (no waiver) -> fail + hasUnwaivedFailures = true
 *  2) SCA: critical severity above max WITH waiver -> fail_waived + hasUnwaivedFailures = false
 *  3) Happy-path: all severities within limits -> pass + hasUnwaivedFailures = false
 */

import { evaluateSecurity } from "../../scripts/policy/eval.mjs";

/**
 * Minimal assertion helper – throws on failure.
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

/**
 * Scenario 1:
 *  - SAST max_severity = "medium"
 *  - Findings include 1 x "high"
 *  - No waivers
 * Expected:
 *  - decision.security.sast.result === "fail"
 *  - hasUnwaivedFailures === true
 */
function testSastHighAboveMediumNoWaiver() {
  const policy = {
    security: {
      sast: {
        tool: "codeql",
        max_severity: "medium"
      },
      sca: {
        tool: "npm-audit",
        max_severity: "high"
      }
    },
    waivers: [] // no waivers
  };

  const securityFindings = {
    sast: {
      tool: "codeql",
      report_path: "reports/codeql-results.json",
      counts: {
        none: 0,
        low: 0,
        medium: 0,
        high: 1,
        critical: 0
      }
    },
    sca: {
      tool: "npm-audit",
      report_path: "reports/npm-audit.json",
      counts: {
        none: 0,
        low: 0,
        medium: 0,
        high: 0,
        critical: 0
      }
    }
  };

  const { decision, hasUnwaivedFailures } = evaluateSecurity({
    policy,
    securityFindings,
    decision: {}
  });

  const sast = decision.security?.sast;

  assert(sast, "SAST section missing on decision.security");
  assert(
    sast.result === "fail",
    `Expected SAST result "fail" but got "${sast.result}"`
  );
  assert(
    hasUnwaivedFailures === true,
    `Expected hasUnwaivedFailures === true but got ${hasUnwaivedFailures}`
  );
}

/**
 * Scenario 2:
 *  - SCA max_severity = "high"
 *  - Findings include 1 x "critical"
 *  - Active waiver for rule "security.sca"
 * Expected:
 *  - decision.security.sca.result === "fail_waived"
 *  - hasUnwaivedFailures === false
 */
function testScaCriticalWithWaiver() {
  const policy = {
    security: {
      sast: {
        tool: "codeql",
        max_severity: "high"
      },
      sca: {
        tool: "npm-audit",
        max_severity: "high"
      }
    },
    waivers: [
      {
        rule: "security.sca",
        scope: "CVE-2025-12345",
        reason: "Vendor patch pending; compensating control in WAF",
        ttl: "2099-12-31", // far future so the waiver is always active
        approver: "@security-lead",
        evidence: "https://internal/wiki/waivers/CVE-2025-12345"
      }
    ]
  };

  const securityFindings = {
    sast: {
      tool: "codeql",
      report_path: "reports/codeql-results.json",
      counts: {
        none: 0,
        low: 0,
        medium: 0,
        high: 0,
        critical: 0
      }
    },
    sca: {
      tool: "npm-audit",
      report_path: "reports/npm-audit.json",
      counts: {
        none: 0,
        low: 0,
        medium: 0,
        high: 0,
        critical: 1
      }
    }
  };

  const { decision, hasUnwaivedFailures } = evaluateSecurity({
    policy,
    securityFindings,
    decision: {}
  });

  const sca = decision.security?.sca;

  assert(sca, "SCA section missing on decision.security");
  assert(
    sca.result === "fail_waived",
    `Expected SCA result "fail_waived" but got "${sca.result}"`
  );
  assert(
    Array.isArray(sca.waivers_applied) && sca.waivers_applied.length > 0,
    "Expected at least one applied waiver on sca.waivers_applied"
  );
  assert(
    hasUnwaivedFailures === false,
    `Expected hasUnwaivedFailures === false but got ${hasUnwaivedFailures}`
  );
}

/**
 * Scenario 3 (happy path):
 *  - SAST max_severity = "high", findings up to "medium"
 *  - SCA max_severity = "high", findings up to "medium"
 *  - No waivers needed
 * Expected:
 *  - decision.security.sast.result === "pass"
 *  - decision.security.sca.result === "pass"
 *  - hasUnwaivedFailures === false
 */
function testHappyPathWithinThresholds() {
  const policy = {
    security: {
      sast: {
        tool: "codeql",
        max_severity: "high"
      },
      sca: {
        tool: "npm-audit",
        max_severity: "high"
      }
    },
    waivers: []
  };

  const securityFindings = {
    sast: {
      tool: "codeql",
      report_path: "reports/codeql-results.json",
      counts: {
        none: 0,
        low: 1,
        medium: 2,
        high: 0,
        critical: 0
      }
    },
    sca: {
      tool: "npm-audit",
      report_path: "reports/npm-audit.json",
      counts: {
        none: 0,
        low: 3,
        medium: 1,
        high: 0,
        critical: 0
      }
    }
  };

  const { decision, hasUnwaivedFailures } = evaluateSecurity({
    policy,
    securityFindings,
    decision: {}
  });

  const sast = decision.security?.sast;
  const sca = decision.security?.sca;

  assert(sast, "SAST section missing on decision.security");
  assert(sca, "SCA section missing on decision.security");

  assert(
    sast.result === "pass",
    `Expected SAST result "pass" but got "${sast.result}"`
  );
  assert(
    sca.result === "pass",
    `Expected SCA result "pass" but got "${sca.result}"`
  );
  assert(
    hasUnwaivedFailures === false,
    `Expected hasUnwaivedFailures === false but got ${hasUnwaivedFailures}`
  );
}

// -------- MAIN --------------------------------------------------------------

(async function main() {
  try {
    testSastHighAboveMediumNoWaiver();
    console.log("✓ SAST high severity above medium (no waiver) -> fail as expected");

    testScaCriticalWithWaiver();
    console.log("✓ SCA critical severity with valid waiver -> fail_waived as expected");

    testHappyPathWithinThresholds();
    console.log("✓ Happy-path (all within thresholds) -> pass as expected");

    console.log("✅ Security eval smoke tests passed.");
    process.exit(0);
  } catch (err) {
    console.error("✗ FAIL (security-eval.smoke.mjs):", err.message);
    process.exit(1);
  }
})();
