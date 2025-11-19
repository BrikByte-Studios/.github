/**
 * Smoke tests — coverage delta behaviour (PIPE-GOV-7.3.2)
 *
 * Scenarios:
 *   1) baseline 90, current 86, delta_min -2  => FAIL
 *   2) baseline 90, current 89, delta_min -2  => PASS
 */

const {
  evaluateCoveragePolicy
} = require("../../scripts/policy/coverage-utils");

function assert(cond, msg) {
  if (!cond) {
    console.error(`✗ FAIL (coverage.delta): ${msg}`);
    process.exit(1);
  }
}

(function main() {
  const orgTests = { coverage_min: 80 };
  const effectiveTests = {
    coverage_min: 80,
    coverage_delta_min: -2
  };

  // Case 1: delta too low (should fail)
  const failDecision = evaluateCoveragePolicy({
    orgTests,
    effectiveTests,
    coverageCurrent: 86,
    coverageBaseline: 90
  });

  assert(
    failDecision.result === "fail",
    `expected fail for 86 vs baseline 90, got ${failDecision.result}`
  );
  assert(
    typeof failDecision.delta === "number" && failDecision.delta === -4,
    `expected delta -4, got ${failDecision.delta}`
  );

  // Case 2: acceptable delta (should pass)
  const passDecision = evaluateCoveragePolicy({
    orgTests,
    effectiveTests,
    coverageCurrent: 89,
    coverageBaseline: 90
  });

  assert(
    passDecision.result === "pass",
    `expected pass for 89 vs baseline 90, got ${passDecision.result}`
  );
  assert(
    typeof passDecision.delta === "number" && passDecision.delta === -1,
    `expected delta -1, got ${passDecision.delta}`
  );

  console.log("✓ PASS (coverage.delta)");
})();
