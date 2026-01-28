/**
 * Validates BrikByteOS policy-as-code files against the JSON Schema.
 *
 * Why this exists:
 * - Prevent silent misconfiguration of governance settings (e.g., SemVer rules)
 * - Provide fast feedback in CI before broken policies reach downstream repos
 *
 * Override model (v1 minimal):
 * - If `.github/policy.local.yml` exists, it is layered on top of `.github/policy.yml`
 * - Overlay is shallow-merged per object key (no deep merge complexity)
 *
 * Usage:
 *   node scripts/validate-policy.js
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const Ajv = require("ajv");

function readYaml(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = yaml.load(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`YAML file did not parse into an object: ${filePath}`);
  }
  return parsed;
}

/**
 * Shallow overlay merge:
 * - For each top-level key in overlay, replace base[key] if scalar/array
 * - If both are objects, merge one level deep (still shallow)
 *
 * This is intentionally conservative for v1 to avoid complex inheritance semantics.
 */
function shallowOverlay(base, overlay) {
  const out = { ...base };

  for (const key of Object.keys(overlay)) {
    const oVal = overlay[key];
    const bVal = out[key];

    const bothObjects =
      bVal &&
      oVal &&
      typeof bVal === "object" &&
      typeof oVal === "object" &&
      !Array.isArray(bVal) &&
      !Array.isArray(oVal);

    if (!bothObjects) {
      out[key] = oVal;
      continue;
    }

    // Merge one level deep
    out[key] = { ...bVal, ...oVal };
  }

  return out;
}

function fileExists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function main() {
  const root = process.cwd();

  const policyPath = path.join(root, ".github", "policy.yml");
  const overlayPath = path.join(root, ".github", "policy.local.yml");
  const schemaPath = path.join(root, "schemas", "policy.schema.json");

  if (!fileExists(policyPath)) {
    console.error(`ERROR: missing policy file: ${policyPath}`);
    process.exit(2);
  }
  if (!fileExists(schemaPath)) {
    console.error(`ERROR: missing schema file: ${schemaPath}`);
    process.exit(2);
  }

  const basePolicy = readYaml(policyPath);
  const finalPolicy = fileExists(overlayPath)
    ? shallowOverlay(basePolicy, readYaml(overlayPath))
    : basePolicy;

  const schemaRaw = fs.readFileSync(schemaPath, "utf-8");
  const schemaJson = JSON.parse(schemaRaw);

  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schemaJson);

  const ok = validate(finalPolicy);

  if (!ok) {
    console.error("❌ Policy validation FAILED.");
    console.error("Schema errors:");
    for (const err of validate.errors || []) {
      console.error(`- ${err.instancePath || "(root)"}: ${err.message}`);
    }

    console.error("\nHelpful tips:");
    console.error("- `release.semver.tag_pattern` must be strict vX.Y.Z in v1.");
    console.error("- `allowed_branches` must be non-empty when semver.enabled=true.");
    console.error("- `initial_version` must match ^v\\d+\\.\\d+\\.\\d+$.");

    process.exit(1);
  }

  console.log("✅ Policy validation PASSED.");
  if (fileExists(overlayPath)) {
    console.log(`Overlay applied: ${overlayPath}`);
  }
}

main();
