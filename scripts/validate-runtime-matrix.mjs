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
 *   3) Performs extra "policy sanity checks" that JSON schema cannot express easily.
 *
 * Mitigations enforced in code (beyond schema):
 *   - Support tiers behavior rules (experimental requires references)
 *   - N/N-1 means at least two supported versions
 *   - Controlled overrides must be time-bound and approved
 *   - Start minimal: require adoptionPriority and at least one primary stack
 *   - Optional contingency disputes must have review dates
 *
 * Intended usage:
 *   - CI: runs on PRs that touch runtime-matrix.yml or schema files
 *   - Local: developers can run `node scripts/validate-runtime-matrix.mjs`
 *
 * Notes:
 *   - No network calls
 *   - Keeps runtime under ~1 second for typical files
 * ---------------------------------------------------------------------------
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import yaml from "js-yaml";
import Ajv from "ajv";

const ROOT = process.cwd();
const MATRIX_PATH = path.join(ROOT, "docs", "pipelines", "runtime-matrix.yml");
const SCHEMA_PATH = path.join(ROOT, "schemas", "runtime-matrix.schema.json");

/**
 * Rough ISO-date check (YYYY-MM-DD).
 * We keep it lightweight and deterministic (no locale/timezone parsing).
 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reference check for governance notes.
 * Examples:
 *  - ADR-PIPE-001
 *  - ADR-XYZ-123
 *  - #456
 */
const REF_RE = /(ADR-[A-Z0-9-]+|#\d+)/;

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

  // --- Global-level contingency checks (optional feature) ---
  if (matrix?.contingency) {
    const disputes = matrix?.contingency?.disputes;
    if (!Array.isArray(disputes) || disputes.length === 0) {
      errors.push(`[contingency] If contingency is present, contingency.disputes must be a non-empty array`);
    } else {
      for (const d of disputes) {
        const nextReview = d?.nextReview;
        if (typeof nextReview !== "string" || !ISO_DATE_RE.test(nextReview)) {
          errors.push(`[contingency] dispute nextReview must be YYYY-MM-DD (got: "${nextReview}")`);
        }
      }
    }
  }

  // --- Stack-level checks ---
  let primaryCount = 0;

  for (const stack of matrix.stacks ?? []) {
    const name = stack?.runtime?.name ?? "unknown-runtime";
    const supported = stack?.supportedVersions?.versions ?? [];
    const policy = stack?.supportedVersions?.policy;
    const def = stack?.defaultVersion;

    // Mitigation 3: Start minimal but explicit - require adoptionPriority
    const prio = stack?.adoptionPriority;
    if (prio === "primary") primaryCount++;
    if (!["primary", "secondary"].includes(prio)) {
      errors.push(`[${name}] adoptionPriority must be "primary" or "secondary"`);
    }

    // Ensure defaultVersion is included in supportedVersions list (or matches a prefix)
    if (!def) {
      errors.push(`[${name}] defaultVersion missing`);
    } else {
      // Matches exact or "prefix-ish" for .x patterns (20.x matches 20.x / 20 / 20.0 etc)
      const prefix = def.replace(/\.x$/, ""); // only trims trailing ".x"
      const matches = supported.some((v) => v === def || (prefix && v.startsWith(prefix)));
      if (!matches) {
        errors.push(`[${name}] defaultVersion "${def}" not compatible with supportedVersions: ${supported.join(", ")}`);
      }
    }

    // Mitigation 2: Enforce N/N-1 means >= 2 versions listed
    if (policy === "N/N-1" && supported.length < 2) {
      errors.push(`[${name}] supportedVersions.policy=N/N-1 requires at least 2 versions (N and N-1)`);
    }
    if (policy === "LTS-only" && supported.length < 1) {
      errors.push(`[${name}] supportedVersions.policy=LTS-only requires at least 1 version`);
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

    // Mitigation 1: Support tiers behavior - experimental must be traceable via a reference in notes
    const status = stack?.supportStatus;
    const notes = stack?.notes ?? [];
    if (status === "experimental") {
      const hasRef = Array.isArray(notes) && notes.some((n) => typeof n === "string" && REF_RE.test(n));
      if (!hasRef) {
        errors.push(`[${name}] supportStatus=experimental requires a reference in notes (e.g., "ADR-PIPE-001" or "#123")`);
      }
    }

    // Mitigation 2: Controlled override later - if exceptions enabled, enforce expiry + approval reference
    const ex = stack?.exceptions;
    if (ex?.enabled === true) {
      const rules = ex?.rules ?? [];
      if (!Array.isArray(rules) || rules.length === 0) {
        errors.push(`[${name}] exceptions.enabled=true requires exceptions.rules to be a non-empty array`);
      } else {
        for (const r of rules) {
          const id = r?.id ?? "unknown-exception";
          const expiresOn = r?.expiresOn;
          const approvalRef = r?.approval?.reference;

          if (typeof expiresOn !== "string" || !ISO_DATE_RE.test(expiresOn)) {
            errors.push(`[${name}] exception "${id}" must include expiresOn in YYYY-MM-DD format`);
          }
          if (typeof approvalRef !== "string" || approvalRef.trim().length === 0) {
            errors.push(`[${name}] exception "${id}" must include approval.reference (issue/ADR link)`);
          }
        }
      }
    }
  }

  // Ensure at least one primary stack exists (Mitigation 3)
  if (primaryCount < 1) {
    errors.push(`[stacks] At least one stack must have adoptionPriority="primary" (expected Node/Python in v1)`);
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
