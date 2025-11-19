/**
 * Smoke test — coverage below coverage_min should FAIL.
 */

const {
  evaluateCoveragePolicy
} = require("../../scripts/policy/coverage-utils");

(function main() {
  const orgTests = { coverage_min: 80 };
  const effectiveTests = { coverage_min: 80, coverage_delta_min: -2 };

  const decision = evaluateCoveragePolicy({
    orgTests,
    effectiveTests,
    coverageCurrent: 75,
    coverageBaseline: null
  });

  if (decision.result !== "fail") {
    console.error(
      `✗ FAIL (coverage.absolute-fail): expected fail, got ${decision.result}`
    );
    process.exit(1);
  }

  if (
    !decision.reason ||
    !decision.reason.includes("Coverage 75% below minimum 80%")
  ) {
    console.error(
      `✗ FAIL (coverage.absolute-fail): unexpected reason: ${decision.reason}`
    );
    process.exit(1);
  }

  console.log("✓ PASS (coverage.absolute-fail)");
})();