/**
 * BrikByteOS Pipelines — Runtime Matrix Validator
 *
 * Why this exists:
 *   The runtime-matrix.yml is a governance-critical artifact. If it drifts,
 *   downstream pipeline templates and schema validation become arbitrary.
 *
 * What this script does:
 *   1) Loads the YAML runtime matrix
 *   2) Validates it against runtime-matrix.schema.json (AJV)
 *   3) Performs a few extra "policy sanity checks" that JSON schema cannot
 *      express easily (e.g., defaultVersion must be included in supportedVersions)
 *
 * Intended usage:
 *   - CI: runs on PRs that touch runtime-matrix.yml or schema files
 *   - Local: developers can run `node scripts/validate-runtime-matrix.mjs`
 *
 * Notes:
 *   - No network calls
 *   - Keeps runtime under ~1 second for typical files
 * -----------------------------------------------------------------------------
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import yaml from "js-yaml";
import Ajv from "ajv";

const ROOT = process.cwd();
const MATRIX_PATH = path.join(ROOT, "docs", "pipelines", "runtime-matrix.yml");
const SCHEMA_PATH = path.join(ROOT, "schemas", "runtime-matrix.schema.json");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function readYaml(p) {
  return yaml.load(fs.readFileSync(p, "utf-8"));
}

/**
 * Additional policy checks that go beyond JSON Schema.
 * @param {any} matrix Parsed YAML object.
 * @returns {{ok: boolean, errors: string[]}}
 */
function policySanityChecks(matrix) {
  const errors = [];

  // Ensure each stack defaultVersion is included in supportedVersions list (or matches a prefix)
  for (const stack of matrix.stacks ?? []) {
    const name = stack?.runtime?.name;
    const supported = stack?.supportedVersions?.versions ?? [];
    const def = stack?.defaultVersion;

    if (!def) {
      errors.push(`[${name}] defaultVersion missing`);
      continue;
    }

    // Some defaults contain .x (e.g., 20.x) while supported list contains exact patterns.
    // We'll treat "20.x" as matching "20.x" or any supported entry that starts with "20".
    const matches = supported.some((v) => v === def || v.startsWith(def.replace(".x", "")));

    if (!matches) {
      errors.push(
        `[${name}] defaultVersion "${def}" not compatible with supportedVersions: ${supported.join(", ")}`
      );
    }

    // Ensure default tools are included in allowed tool lists
    const pmDefault = stack?.toolchain?.packageManagers?.default;
    const pmAllowed = stack?.toolchain?.packageManagers?.allowed ?? [];
    if (pmDefault && !pmAllowed.includes(pmDefault)) {
      errors.push(`[${name}] packageManagers.default "${pmDefault}" not in allowed list: ${pmAllowed.join(", ")}`);
    }

    const btDefault = stack?.toolchain?.buildTools?.default;
    const btAllowed = stack?.toolchain?.buildTools?.allowed ?? [];
    if (btDefault && !btAllowed.includes(btDefault)) {
      errors.push(`[${name}] buildTools.default "${btDefault}" not in allowed list: ${btAllowed.join(", ")}`);
    }

    // Minimal command sanity: install/test/build must exist and be non-empty strings
    const cmds = stack?.defaultCommands ?? {};
    for (const key of ["install", "test", "build"]) {
      const val = cmds[key];
      if (typeof val !== "string" || val.trim().length === 0) {
        errors.push(`[${name}] defaultCommands.${key} must be a non-empty string`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function main() {
  if (!fs.existsSync(MATRIX_PATH)) {
    console.error(`❌ runtime matrix not found at: ${MATRIX_PATH}`);
    process.exit(2);
  }
  if (!fs.existsSync(SCHEMA_PATH)) {
    console.error(`❌ schema not found at: ${SCHEMA_PATH}`);
    process.exit(2);
  }

  const matrix = readYaml(MATRIX_PATH);
  const schema = readJson(SCHEMA_PATH);

  const ajv = new Ajv({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);

  const valid = validate(matrix);

  if (!valid) {
    console.error("❌ Schema validation failed for runtime-matrix.yml");
    for (const err of validate.errors ?? []) {
      console.error(`- ${err.instancePath || "/"} ${err.message}`);
    }
    process.exit(1);
  }

  const policy = policySanityChecks(matrix);
  if (!policy.ok) {
    console.error("❌ Policy sanity checks failed for runtime-matrix.yml");
    for (const e of policy.errors) console.error(`- ${e}`);
    process.exit(1);
  }

  console.log("✅ runtime-matrix.yml is valid (schema + policy sanity checks)");
}

main();
