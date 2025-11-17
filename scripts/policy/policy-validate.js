#!/usr/bin/env node
/**
 * BrikByte Studios — Policy Validator (PIPE-GOV-7.1)
 *
 * Responsibilities:
 *  - Parse a policy YAML file (e.g. .github/policy.yml)
 *  - Validate against docs/policy/policy.schema.json using JSON Schema (Ajv)
 *  - Enforce extra lint rules, e.g.:
 *      * tests.coverage_min >= ORG_MIN_COVERAGE (minimum safety baseline)
 *  - Emit GitHub Actions annotations on errors
 *  - Exit non-zero on any failure
 *
 * Usage (CI / CLI):
 *   node scripts/policy/policy-validate.js \
 *     --schema docs/policy/policy.schema.json \
 *     --file .github/policy.yml
 */

const fs = require("fs");
const path = require("path");
const yaml = require("yaml");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

/** Org-wide minimum safety coverage baseline (percentage). */
const ORG_MIN_COVERAGE = 50;

/**
 * Tiny CLI args parser (flags like --schema, --file).
 */
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

/**
 * Emit a GitHub Actions "error" annotation.
 *
 * https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#setting-an-error-message
 */
function ghError({ file, line, message }) {
  const linePart = line ? `,line=${line}` : "";
  console.error(`::error file=${file}${linePart}::${message}`);
}

/**
 * Load JSON Schema from disk.
 */
function loadSchema(schemaPath) {
  const raw = fs.readFileSync(schemaPath, "utf-8");
  return JSON.parse(raw);
}

/**
 * Load and parse a YAML policy file.
 *
 * Returns:
 *   { policy: object, raw: string }
 */
function loadPolicy(policyPath) {
  const raw = fs.readFileSync(policyPath, "utf-8");
  let policy;
  try {
    policy = yaml.parse(raw) || {};
  } catch (err) {
    throw new Error(
      `YAML parse error in "${policyPath}": ${err.message}`
    );
  }
  if (typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error(
      `Policy file "${policyPath}" must parse to an object at the top level.`
    );
  }
  return { policy, raw };
}

/**
 * Validate policy object using Ajv + provided schema.
 *
 * Returns:
 *   { ok: boolean, errors: Array<{ message: string }> }
 */
function validatePolicySchema(ajvValidate, policy, policyPath) {
  const ok = ajvValidate(policy);
  if (ok) return { ok: true, errors: [] };

  const errors = (ajvValidate.errors || []).map((err) => {
    const instancePath = err.instancePath || "";
    const property = instancePath ? instancePath.replace(/^\//, "") : "(root)";
    const msg = `Schema validation error in "${policyPath}" at "${property}": ${err.message}`;
    return { message: msg };
  });

  return { ok: false, errors };
}

/**
 * Extra lint rules that go beyond the JSON Schema.
 *
 * - Enforces ORG_MIN_COVERAGE (e.g. 50%) as a hard minimum for tests.coverage_min.
 */
function lintPolicy(policy, policyPath) {
  const issues = [];

  const tests = policy.tests || {};
  const coverage = tests.coverage_min;

  if (typeof coverage === "number") {
    if (coverage < ORG_MIN_COVERAGE) {
      issues.push({
        message: `tests.coverage_min is ${coverage}, which is below the org minimum (${ORG_MIN_COVERAGE}). Policy must not weaken baseline safety coverage.`
      });
    }
  }

  // You can add more lint rules here later, e.g.:
  // - When mode: "enforce", require stricter security thresholds
  // - Ensure docs.paths is non-empty if require_docs_on_feature_change is true

  return issues;
}

/**
 * Main entrypoint.
 */
async function main() {
  const args = parseArgs(process.argv);
  const schemaPath =
    args.schema || "docs/policy/policy.schema.json";
  const policyPath =
    args.file || ".github/policy.yml";

  if (!fs.existsSync(schemaPath)) {
    console.error(
      `Policy schema not found at "${schemaPath}". Ensure docs/policy/policy.schema.json exists.`
    );
    process.exit(1);
  }

  if (!fs.existsSync(policyPath)) {
    console.error(
      `Policy file not found at "${policyPath}". Ensure .github/policy.yml exists or pass --file PATH.`
    );
    process.exit(1);
  }

  // Setup Ajv
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = loadSchema(schemaPath);
  const validate = ajv.compile(schema);

  let policy;
  try {
    ({ policy } = loadPolicy(policyPath));
  } catch (err) {
    ghError({ file: policyPath, line: 1, message: err.message });
    process.exit(1);
  }

  let errorCount = 0;

  // 1) Schema validation
  const schemaResult = validatePolicySchema(validate, policy, policyPath);
  if (!schemaResult.ok) {
    for (const e of schemaResult.errors) {
      errorCount++;
      ghError({ file: policyPath, line: 1, message: e.message });
    }
  }

  // 2) Extra lint
  const lintIssues = lintPolicy(policy, policyPath);
  for (const issue of lintIssues) {
    errorCount++;
    ghError({ file: policyPath, line: 1, message: issue.message });
  }

  if (errorCount > 0) {
    console.error(
      `Policy validation failed: ${errorCount} violation(s) found in "${policyPath}".`
    );
    process.exit(1);
  }

  console.log(
    `Policy validation succeeded: "${policyPath}" conforms to schema and lint rules.`
  );
  process.exit(0);
}

// Ensure we never crash without emitting something useful
main().catch((err) => {
  ghError({
    file: "scripts/policy/policy-validate.js",
    message: `Unexpected error during policy validation: ${err.message}`
  });
  process.exit(1);
});
