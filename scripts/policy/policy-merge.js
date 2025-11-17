#!/usr/bin/env node
/**
 * BrikByte Studios — Policy Merge CLI (PIPE-GOV-7.2)
 *
 * Purpose
 * -------
 * Compute an "effective" policy for a repo by merging:
 *
 *   1) Base (org-level) policy.yml   --base
 *   2) Repo-level override policy    --repo
 *
 * using deterministic merge semantics and enforcing non-relaxable constraints.
 *
 * This script is the contract for:
 *   - Repo-level policy overrides via `extends: org`
 *   - Enforcing that repos can tighten policy but not weaken critical controls
 *   - Producing a machine-readable "effective policy" for downstream consumption
 *     (e.g., PIPE-POLICY-015, ObservabilityOps, ComplianceOps)
 *
 * Usage
 * -----
 *   node scripts/policy/policy-merge.js \
 *     --base .github/policy.yml \
 *     --repo ./policy.yml \
 *     --schema docs/policy/policy.schema.json \
 *     --out ./out/effective-policy.json
 *
 * Exit codes
 * ----------
 *   0  - merge & constraint checks succeeded
 *   >0 - validation error, illegal relaxation, or runtime error
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const Ajv = require("ajv");

/**
 * Simple CLI arg parser:
 *   --key value  → args[key] = value
 *   --flag       → args[flag] = true
 *
 * @param {string[]} argv process.argv
 * @returns {Record<string, string|boolean>}
 */
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith("--")) continue;
    const key = raw.replace(/^--/, "");
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

/**
 * Load a YAML file into JS object.
 *
 * @param {string} filePath
 * @returns {any}
 */
function loadYaml(filePath) {
  try {
    const text = fs.readFileSync(filePath, "utf8");
    return yaml.load(text);
  } catch (err) {
    console.error(`::error file=${filePath}::Failed to read or parse YAML: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Load and compile JSON Schema using Ajv.
 *
 * @param {string} schemaPath
 * @returns {{validate: (data:any)=>boolean, errors:any[] | null}}
 */
function buildValidator(schemaPath) {
  try {
    const schemaText = fs.readFileSync(schemaPath, "utf8");
    const schemaJson = JSON.parse(schemaText);

    // Ajv configured for our governance schema (draft-07 or similar).
    const ajv = new Ajv({
      allErrors: true,
      strict: false
    });

    const validate = ajv.compile(schemaJson);
    return {
      validate,
      get errors() {
        return validate.errors || null;
      }
    };
  } catch (err) {
    console.error(`::error file=${schemaPath}::Failed to load or compile schema: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Pretty-print Ajv errors for GitHub annotations and console.
 *
 * @param {string} filePath
 * @param {any[]} errors
 */
function reportSchemaErrors(filePath, errors) {
  console.error(`Schema validation failed for ${filePath}`);
  for (const err of errors || []) {
    const instancePath = err.instancePath || "";
    const message = err.message || "validation error";
    console.error(`  - ${instancePath}: ${message}`);
    console.error(`::error file=${filePath},title=Schema error::${instancePath} ${message}`);
  }
}

/**
 * Deep clone via JSON.
 * Good enough for small policy objects.
 *
 * @param {any} obj
 */
function deepClone(obj) {
  return obj == null ? obj : JSON.parse(JSON.stringify(obj));
}

/**
 * Determine if a value is a plain object (not array / null).
 *
 * @param {any} v
 * @returns {boolean}
 */
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Merge arrays by union (dedupe by strict equality).
 *
 * @param {any[] | undefined} baseArr
 * @param {any[] | undefined} repoArr
 * @returns {any[]}
 */
function mergeArrays(baseArr, repoArr) {
  const result = [];
  const seen = new Set();

  for (const v of baseArr || []) {
    const key = JSON.stringify(v);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(v);
    }
  }
  for (const v of repoArr || []) {
    const key = JSON.stringify(v);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(v);
    }
  }

  return result;
}

/**
 * Deep merge base + repo policy objects according to semantics:
 *
 *   - Objects: recurse + merge keys
 *   - Scalars: repo wins
 *   - Arrays: union (dedupe)
 *
 * Note: The `extends` key is handled outside and never appears on
 * the effective merged policy E.
 *
 * @param {any} base Base policy object
 * @param {any} repo Repo policy object (override)
 * @param {string} pathStr JSON pointer-ish path for error messages
 * @returns {any}
 */
function deepMerge(base, repo, pathStr = "") {
  const result = deepClone(base) || {};

  for (const key of Object.keys(repo || {})) {
    if (key === "extends") {
      // `extends` is a directive, not part of the effective policy.
      continue;
    }

    const repoVal = repo[key];
    const baseVal = base ? base[key] : undefined;
    const childPath = pathStr ? `${pathStr}.${key}` : key;

    if (Array.isArray(repoVal)) {
      result[key] = mergeArrays(
        Array.isArray(baseVal) ? baseVal : [],
        repoVal
      );
    } else if (isPlainObject(repoVal)) {
      if (isPlainObject(baseVal)) {
        result[key] = deepMerge(baseVal, repoVal, childPath);
      } else {
        // Repo has an object where base has scalar/undefined → repo wins
        result[key] = deepMerge({}, repoVal, childPath);
      }
    } else {
      // Scalar override: repo wins
      result[key] = repoVal;
    }
  }

  return result;
}

/**
 * Map security threshold to a numeric "strictness" level.
 *
 * Higher number = stricter.
 *
 * "none"       → 0 (no enforcement)
 * "no-critical"→ 1
 * "no-high"    → 2 (most strict)
 *
 * @param {"none"|"no-critical"|"no-high"|string|undefined} value
 * @returns {number}
 */
function thresholdLevel(value) {
  if (value === "no-high") return 2;
  if (value === "no-critical") return 1;
  if (value === "none") return 0;
  // Unknown value → treat as weakest for constraint comparison
  return -1;
}

/**
 * Enforce non-relaxable constraints after merge.
 *
 * We compare:
 *   - Effective policy `E`
 *   - Base org policy  `B`
 *
 * Rules:
 *   1) mode: cannot go from enforce → advisory
 *   2) tests.coverage_min: E >= B (if base defined)
 *   3) security thresholds: E must be >= B in strictness order
 *   4) supply_chain.require_signed_artifacts: cannot go from true → false
 *   5) supply_chain.require_sbom: cannot go from true → false
 *
 * @param {any} basePolicy
 * @param {any} effectivePolicy
 * @param {string} basePath descriptor for base (used in messages)
 */
function enforceNonRelaxableConstraints(basePolicy, effectivePolicy, basePath = ".github/policy.yml") {
  const errors = [];

  // 1) mode
  if (basePolicy && basePolicy.mode === "enforce" && effectivePolicy.mode === "advisory") {
    errors.push(
      `mode cannot be relaxed from "enforce" (base) to "advisory" (effective).`
    );
  }

  // 2) tests.coverage_min
  const baseCov = basePolicy && basePolicy.tests && typeof basePolicy.tests.coverage_min === "number"
    ? basePolicy.tests.coverage_min
    : null;

  const effCov = effectivePolicy && effectivePolicy.tests && typeof effectivePolicy.tests.coverage_min === "number"
    ? effectivePolicy.tests.coverage_min
    : null;

  if (baseCov != null && effCov != null && effCov < baseCov) {
    errors.push(
      `tests.coverage_min (${effCov}) cannot be lower than org baseline (${baseCov}) from ${basePath}.`
    );
  }

  // 3) security thresholds
  const secKeys = ["sast_threshold", "sca_threshold", "dast_threshold"];

  for (const key of secKeys) {
    const baseVal = basePolicy && basePolicy.security && basePolicy.security[key];
    const effVal = effectivePolicy && effectivePolicy.security && effectivePolicy.security[key];

    if (!baseVal || !effVal) continue;

    const baseLevel = thresholdLevel(baseVal);
    const effLevel = thresholdLevel(effVal);

    // eff must be >= base in strictness
    if (effLevel < baseLevel) {
      errors.push(
        `security.${key} ("${effVal}") cannot be weaker than org baseline ("${baseVal}") from ${basePath}.`
      );
    }
  }

  // 4–5) supply_chain boolean hardening
  if (basePolicy && basePolicy.supply_chain && effectivePolicy && effectivePolicy.supply_chain) {
    const baseSC = basePolicy.supply_chain;
    const effSC = effectivePolicy.supply_chain;

    if (baseSC.require_signed_artifacts === true && effSC.require_signed_artifacts === false) {
      errors.push(
        `supply_chain.require_signed_artifacts cannot be disabled (base=true, effective=false).`
      );
    }
    if (baseSC.require_sbom === true && effSC.require_sbom === false) {
      errors.push(
        `supply_chain.require_sbom cannot be disabled (base=true, effective=false).`
      );
    }
  }

  if (errors.length > 0) {
    for (const msg of errors) {
      console.error(`::error title=Policy relaxation not allowed::${msg}`);
    }
    console.error("Policy merge failed due to illegal relaxations of non-relaxable constraints.");
    process.exit(1);
  }
}

/**
 * Main entrypoint.
 */
function main() {
  const args = parseArgs(process.argv);
  const basePath = args.base;
  const repoPath = args.repo;
  const schemaPath = args.schema;
  const outPath = args.out || "";

  if (!basePath || !repoPath || !schemaPath) {
    console.error(
      "Usage: node scripts/policy/policy-merge.js " +
      "--base .github/policy.yml --repo ./policy.yml " +
      "--schema docs/policy/policy.schema.json [--out ./out/effective-policy.json]"
    );
    process.exit(1);
  }

  const absBasePath = path.resolve(basePath);
  const absRepoPath = path.resolve(repoPath);
  const absSchemaPath = path.resolve(schemaPath);

  if (!fs.existsSync(absBasePath)) {
    console.error(`::error file=${absBasePath}::Base policy file not found.`);
    process.exit(1);
  }
  if (!fs.existsSync(absRepoPath)) {
    console.error(`::error file=${absRepoPath}::Repo policy file not found.`);
    process.exit(1);
  }

  // Build validator once, reuse for both base & repo
  const { validate, errors: _ } = buildValidator(absSchemaPath);

  // Load & validate base policy
  const basePolicyRaw = loadYaml(absBasePath);
  if (!validate(basePolicyRaw)) {
    reportSchemaErrors(absBasePath, validate.errors);
    process.exit(1);
  }

  // Load & validate repo policy (schema includes `extends` in v1)
  const repoPolicyRaw = loadYaml(absRepoPath);
  if (!validate(repoPolicyRaw)) {
    reportSchemaErrors(absRepoPath, validate.errors);
    process.exit(1);
  }

  const basePolicy = deepClone(basePolicyRaw);
  const repoPolicy = deepClone(repoPolicyRaw);

  // Handle extends
  const extendsMode = repoPolicy.extends || "org";

  /** @type {any} */
  let mergedBase;

  if (extendsMode === "org") {
    mergedBase = basePolicy;
  } else if (extendsMode === "none") {
    console.warn(
      `⚠️  extends: "none" used in ${absRepoPath}. This means no org baseline is applied.\n` +
      `   This should only be done with explicit governance approval.`
    );
    mergedBase = {};
  } else {
    console.error(
      `::error file=${absRepoPath},title=Invalid extends value::` +
      `extends: "${extendsMode}" is not supported. Allowed values: "org", "none".`
    );
    process.exit(1);
  }

  // Compute effective policy E = merge(B, R)
  const effectivePolicy = deepMerge(mergedBase, repoPolicy);

  // Enforce non-relaxable constraints *against* the original org baseline
  // (even if extends: none is used, basePolicy still exists as reference).
  enforceNonRelaxableConstraints(basePolicy, effectivePolicy, absBasePath);

  // Write output if requested
  if (outPath) {
    const absOutPath = path.resolve(outPath);
    const outDir = path.dirname(absOutPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(absOutPath, JSON.stringify(effectivePolicy, null, 2), "utf8");
    console.log(`Effective policy written to: ${absOutPath}`);
  } else {
    console.log(JSON.stringify(effectivePolicy, null, 2));
  }

  console.log("Policy merge completed successfully.");
  process.exit(0);
}

main();
