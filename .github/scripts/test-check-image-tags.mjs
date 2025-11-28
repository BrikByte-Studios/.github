#!/usr/bin/env node
/**
 * BrikByteOS Governance — Tiny Test Harness for Image Tag Policy
 *
 * GOV-IMAGES-TAG-POLICY-CONFIG-001
 *
 * File:
 *   .github/scripts/test-check-image-tags.mjs
 *
 * Purpose:
 *   - Provide a super lightweight way to prove that
 *     .github/scripts/check-image-tags.mjs behaves as expected for
 *     the core test cases:
 *
 *       TC-IMGTAG-001 — ["v1.0.0", "sha-0f9b9113"]  => PASS (exit 0)
 *       TC-IMGTAG-002 — ["latest"]                  => FAIL (exit != 0)
 *       TC-IMGTAG-003 — ["v1.0.0"]                  => FAIL (exit != 0)
 *       TC-IMGTAG-004 — ["sha-0f9b9113"]            => FAIL (exit != 0)
 *
 * Usage:
 *   cd .github
 *   node scripts/test-check-image-tags.mjs
 *
 * Exit codes:
 *   0 = all tests passed
 *   1 = at least one test failed or harness error
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Describe the test cases and their expected outcomes.
 *
 * Each test:
 *   - id: short ID for logging
 *   - description: human-readable statement
 *   - fixture: JSON file with image+tags
 *   - expectExit: expected process exit code from check-image-tags.mjs
 */
const TESTS = [
  {
    id: "TC-IMGTAG-001",
    description:
      'Build with tags ["v1.0.0", "sha-0f9b9113"] passes policy check.',
    fixture: "tc-imgtag-001-pass.json",
    expectExit: 0,
  },
  {
    id: "TC-IMGTAG-002",
    description:
      'Build with tags ["latest"] fails with clear error (missing SHA + SemVer).',
    fixture: "tc-imgtag-002-fail-latest-only.json",
    expectExit: 2, // policy violation
  },
  {
    id: "TC-IMGTAG-003",
    description:
      'Build with tags ["v1.0.0"] fails (missing SHA tag).',
    fixture: "tc-imgtag-003-fail-missing-sha.json",
    expectExit: 2,
  },
  {
    id: "TC-IMGTAG-004",
    description:
      'Build with tags ["sha-0f9b9113"] fails (missing SemVer tag).',
    fixture: "tc-imgtag-004-fail-missing-semver.json",
    expectExit: 2,
  },
];

/**
 * Resolve an absolute path to a fixture JSON file.
 *
 * @param {string} filename - Fixture file name under scripts/fixtures.
 * @returns {string}
 */
function fixturePath(filename) {
  return path.resolve(__dirname, "fixtures", filename);
}

/**
 * Run a single test case by invoking the real checker script
 * as a child process:
 *
 *   node .github/scripts/check-image-tags.mjs --config <fixture>
 *
 * @param {typeof TESTS[number]} test
 * @returns {{ passed: boolean; exitCode: number; stdout: string; stderr: string }}
 */
function runTest(test) {
  const configPath = fixturePath(test.fixture);

  const scriptPath = path.resolve(__dirname, "check-image-tags.mjs");

  const result = spawnSync(
    "node",
    [scriptPath, "--config", configPath],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  const exitCode = typeof result.status === "number" ? result.status : 1;
  const passed = exitCode === test.expectExit;

  return {
    passed,
    exitCode,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

/**
 * Main runner: execute all tests and print a small summary table.
 */
function main() {
  console.log("🧪 BrikByteOS — check-image-tags.mjs unit tests\n");

  let failures = 0;

  for (const test of TESTS) {
    console.log(`▶ ${test.id} — ${test.description}`);
    const { passed, exitCode, stdout, stderr } = runTest(test);

    if (passed) {
      console.log(
        `   ✅ PASSED (exit=${exitCode}, expected=${test.expectExit})`
      );
    } else {
      failures += 1;
      console.log(
        `   ❌ FAILED (exit=${exitCode}, expected=${test.expectExit})`
      );
      if (stdout.trim()) {
        console.log("   ├─ stdout:");
        for (const line of stdout.split("\n")) {
          if (line.trim()) console.log(`   │  ${line}`);
        }
      }
      if (stderr.trim()) {
        console.log("   ├─ stderr:");
        for (const line of stderr.split("\n")) {
          if (line.trim()) console.log(`   │  ${line}`);
        }
      }
    }

    console.log(""); // blank line between tests
  }

  if (failures === 0) {
    console.log("🎉 All image tagging policy tests passed.");
    process.exit(0);
  } else {
    console.log(`⚠️ ${failures} test(s) failed.`);
    process.exit(1);
  }
}

main();
