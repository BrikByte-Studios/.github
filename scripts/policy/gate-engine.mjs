#!/usr/bin/env node
/**
 * BrikByte Studios — Aggregated Policy Gate Engine (PIPE-GOV-8.1)
 *
 * Responsibilities:
 *  - Load effective policy (JSON or YAML)
 *  - Load aggregated governance inputs (tests, coverage, security, ADR, integrity, meta)
 *  - Load waivers (normalized per-rule waivers)
 *  - Evaluate rules defined under policy.rules, producing:
 *      - Per-rule results (pass | warn | fail) + flags (waived, missing_evidence)
 *      - Overall status: passed | passed_with_warnings | failed
 *      - Optional numeric score (0–100)
 *  - Write a decision.json payload suitable for:
 *      - Release governance
 *      - Dashboards
 *      - Audit bundles
 *
 * This module is:
 *  - Exportable (evaluatePolicyGate) for unit tests
 *  - Executable as a CLI (node scripts/policy/gate-engine.mjs --policy ... --inputs ...)
 */

import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";

/**
 * Simple CLI arg parser:
 *   --policy PATH
 *   --inputs PATH
 *   --waivers PATH
 *   --out PATH
 */
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

/**
 * Load a JSON or YAML file based on file extension.
 * - .json → JSON.parse
 * - everything else → YAML
 */
function loadJsonOrYaml(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") {
    return JSON.parse(raw);
  }
  // Default to YAML for .yml/.yaml or anything else
  return yaml.parse(raw);
}

/**
 * Parse YYYY-MM-DD into a Date object. Returns null if invalid.
 */
function parseDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * True if the waiver is still valid today (now <= ttl).
 */
function isWaiverActive(waiver) {
  const ttlDate = parseDate(waiver.ttl);
  if (!ttlDate) return false;
  const now = new Date();
  return now.getTime() <= ttlDate.getTime();
}

/**
 * Normalize waivers input into a flat array.
 *
 * Supported shapes:
 *  - [ { rule, ... }, ... ]
 *  - { waivers: [ { rule, ... }, ... ] }
 *  - { rule, ... }   (single waiver object)
 */
function normalizeWaivers(input) {
  if (!input) return [];

  // Already an array → OK
  if (Array.isArray(input)) {
    return input;
  }

  // Common pattern: { waivers: [ ... ] }
  if (Array.isArray(input.waivers)) {
    return input.waivers;
  }

  // Single object → treat as one waiver
  if (typeof input === "object" && input.rule) {
    return [input];
  }

  return [];
}

/**
 * Filter waivers that apply to a specific rule ID (e.g. "coverage.min").
 *
 * Waiver shape (normalized):
 *   {
 *     "rule": "coverage.min",
 *     "scope": "...",
 *     "reason": "...",
 *     "ttl": "2025-12-31",
 *     "approver": "@governance-lead",
 *     "evidence": "https://..."
 *   }
 */
function getActiveWaiversForRule(allWaivers, ruleId) {
  if (!Array.isArray(allWaivers)) return [];
  return allWaivers.filter(
    (w) => w.rule === ruleId && isWaiverActive(w)
  );
}

/**
 * Severity ranks used for basic comparisons.
 * Higher number = more severe.
 */
const SEVERITY_RANK = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

/**
 * Compute maximum observed severity from a simple counts map:
 * {
 *   critical: number,
 *   high: number,
 *   medium: number,
 *   low: number,
 *   none: number
 * }
 */
function maxObservedSeverity(counts = {}) {
  if ((counts.critical || 0) > 0) return "critical";
  if ((counts.high || 0) > 0) return "high";
  if ((counts.medium || 0) > 0) return "medium";
  if ((counts.low || 0) > 0) return "low";
  return "none";
}

/**
 * Evaluate a "tests.green" rule.
 *
 * Policy example:
 *   rules:
 *     tests.green:
 *       severity: "block"
 *       requires_evidence: true
 *
 * Inputs example:
 *   {
 *     tests: {
 *       total: 124,
 *       failed: 0,
 *       status: "green",
 *       report_url: "https://ci/.../tests"
 *     }
 *   }
 */
function evaluateTestsGreen(ruleId, ruleCfg, inputs) {
  const tests = inputs.tests || {};
  const severity = ruleCfg.severity || "block";

  const hasEvidence =
    typeof tests.status === "string" ||
    typeof tests.total === "number" ||
    typeof tests.failed === "number";

  const result = {
    id: ruleId,
    severity,
    result: "pass", // pass | warn | fail
    message: "",
    evidence: tests.report_url || null,
    missing_evidence: false,
    waived: false
  };

  if (!hasEvidence) {
    if (ruleCfg.requires_evidence) {
      result.result = "fail";
      result.missing_evidence = true;
      result.message =
        "Required evidence for tests.green is missing (no tests status/metrics).";
    } else {
      result.result = "warn";
      result.missing_evidence = true;
      result.message =
        "Tests status missing; treating as warning because requires_evidence=false.";
    }
    return result;
  }

  if (tests.status && tests.status.toLowerCase() === "green") {
    result.result = "pass";
    result.message = "All required tests are green.";
  } else if (typeof tests.failed === "number" && tests.failed === 0) {
    result.result = "pass";
    result.message = "No failed tests reported.";
  } else {
    result.result = "fail";
    result.message =
      `Tests are not green. Status=${tests.status || "unknown"}, failed=${tests.failed ?? "unknown"}.`;
  }

  return result;
}

/**
 * Evaluate a "coverage.min" rule.
 *
 * Policy example:
 *   rules:
 *     coverage.min:
 *       severity: "block"
 *       requires_evidence: true
 *       threshold: 80
 *
 * Inputs example:
 *   {
 *     coverage: {
 *       line: 86.3,
 *       branch: 80.1,
 *       report_url: "https://ci/.../coverage"
 *     }
 *   }
 */
function evaluateCoverageMin(ruleId, ruleCfg, inputs) {
  const coverage = inputs.coverage || {};
  const severity = ruleCfg.severity || "block";
  const threshold =
    typeof ruleCfg.threshold === "number" ? ruleCfg.threshold : 0;
  const line =
    typeof coverage.line === "number" ? coverage.line : null;

  const result = {
    id: ruleId,
    severity,
    result: "pass",
    message: "",
    evidence: coverage.report_url || null,
    missing_evidence: false,
    waived: false
  };

  // --- Evidence handling ----------------------------------------------------
  if (line === null) {
    if (ruleCfg.requires_evidence) {
      result.result = "fail";
      result.missing_evidence = true;
      result.message =
        "Required coverage evidence is missing: no numeric line coverage reported.";
    } else {
      result.result = "warn";
      result.missing_evidence = true;
      result.message =
        "Coverage metrics are missing; treating as warning because requires_evidence=false.";
    }
    return result;
  }

  // --- Threshold comparison -------------------------------------------------
  if (line >= threshold) {
    result.result = "pass";
    result.message = `Line coverage ${line}% is >= required minimum ${threshold}%.`;
  } else {
    result.result = "fail";
    // Make it crystal clear this is about *low coverage*
    result.message = `Line coverage ${line}% is too low (required minimum is ${threshold}% for rule "${ruleId}").`;
  }

  return result;
}



/**
 * Helper for security rules (security.sca, security.sast).
 *
 * Policy examples:
 *   rules:
 *     security.sca:
 *       severity: "block"
 *       max_level: "no-critical"   # no-critical | no-high
 *     security.sast:
 *       severity: "warn"
 *       max_level: "no-high"
 *
 * Inputs example:
 *   {
 *     security: {
 *       sca:  { count: { critical: 0, high: 1, medium: 4 } },
 *       sast: { count: { critical: 0, high: 0, medium: 3 } }
 *     }
 *   }
 */
function evaluateSecurityRule(ruleId, ruleCfg, inputs) {
  const severity = ruleCfg.severity || "block";
  const [_, domain] = ruleId.split("."); // "security.sca" → ["security", "sca"]
  const sec = inputs.security || {};
  const domainData = sec[domain] || {};

  const counts = domainData.count || {};
  const observed = maxObservedSeverity(counts);
  const maxLevel = ruleCfg.max_level || "no-critical";

  const result = {
    id: ruleId,
    severity,
    result: "pass",
    message: "",
    evidence: domainData.report_url || null,
    missing_evidence: false,
    waived: false
  };

  const hasEvidence =
    typeof counts.critical === "number" ||
    typeof counts.high === "number" ||
    typeof counts.medium === "number";

  if (!hasEvidence) {
    if (ruleCfg.requires_evidence) {
      result.result = "fail";
      result.missing_evidence = true;
      result.message =
        `Required security evidence missing for ${ruleId} (no counts present).`;
    } else {
      result.result = "warn";
      result.missing_evidence = true;
      result.message =
        `Security counts missing for ${ruleId}; treating as warning because requires_evidence=false.`;
    }
    return result;
  }

  // Fail conditions based on max_level
  let violation = false;
  if (maxLevel === "no-critical") {
    if ((counts.critical || 0) > 0) violation = true;
  } else if (maxLevel === "no-high") {
    if ((counts.critical || 0) > 0 || (counts.high || 0) > 0) violation = true;
  }

  if (!violation) {
    result.result = "pass";
    result.message =
      `Security ${domain.toUpperCase()} within allowed level (${maxLevel}); max observed severity=${observed}.`;
  } else {
    result.result = "fail";
    result.message =
      `Security ${domain.toUpperCase()} violates ${maxLevel}; max observed severity=${observed}.`;
  }

  return result;
}

/**
 * Evaluate ADR requirement rule (e.g. "adr.required_for_infra").
 *
 * Policy example:
 *   rules:
 *     adr.required_for_infra:
 *       severity: "block"
 *       requires_evidence: true
 *
 * Inputs example:
 *   {
 *     adr: {
 *       required: true,
 *       referenced: ["ADR-0003"],
 *       missing_required: false,
 *       details_url: "https://github.com/.../pull/42"
 *     }
 *   }
 */
function evaluateAdrRequired(ruleId, ruleCfg, inputs) {
  const adr = inputs.adr || {};
  const severity = ruleCfg.severity || "block";

  const result = {
    id: ruleId,
    severity,
    result: "pass",
    message: "",
    evidence: adr.details_url || null,
    missing_evidence: false,
    waived: false
  };

  const hasEvidence =
    typeof adr.required === "boolean" ||
    Array.isArray(adr.referenced) ||
    typeof adr.missing_required === "boolean";

  if (!hasEvidence) {
    if (ruleCfg.requires_evidence) {
      result.result = "fail";
      result.missing_evidence = true;
      result.message =
        "Required ADR evidence missing (adr.required/adr.referenced not present).";
    } else {
      result.result = "warn";
      result.missing_evidence = true;
      result.message =
        "ADR inputs missing; treating as warning because requires_evidence=false.";
    }
    return result;
  }

  if (adr.required && adr.missing_required) {
    result.result = "fail";
    result.message =
      "ADR is required for this change but no valid ADR reference was provided.";
  } else if (adr.required && Array.isArray(adr.referenced) && adr.referenced.length > 0) {
    result.result = "pass";
    result.message =
      `ADR required and satisfied by references: ${adr.referenced.join(", ")}.`;
  } else if (!adr.required) {
    result.result = "pass";
    result.message = "ADR not required for this change (per upstream gate).";
  } else {
    // Defensive fallback
    result.result = "fail";
    result.message =
      "ADR state is ambiguous (required=true but references are empty or missing).";
  }

  return result;
}

/**
 * Evaluate supply chain / artifact integrity rule:
 *   - supplychain.signed (signed artifacts)
 *   - integrity.sbom      (SBOM presence)
 *
 * These are evaluated from aggregated "integrity" inputs:
 *
 *   {
 *     integrity: {
 *       sbom_present: true,
 *       signed_artifacts: true,
 *       hashes_verified: true,
 *       sbom_url: "https://ci/.../sbom",
 *       integrity_report_url: "https://ci/.../integrity"
 *     }
 *   }
 */
function evaluateIntegrityRule(ruleId, ruleCfg, inputs) {
  const integrity = inputs.integrity || {};
  const severity = ruleCfg.severity || "block";

  const result = {
    id: ruleId,
    severity,
    result: "pass",
    message: "",
    evidence: integrity.integrity_report_url || integrity.sbom_url || null,
    missing_evidence: false,
    waived: false
  };

  let hasEvidence = false;
  let ok = true;

  if (ruleId === "supplychain.signed" || ruleId === "integrity.signed") {
    const val = integrity.signed_artifacts;
    hasEvidence = typeof val === "boolean";
    if (!hasEvidence) {
      if (ruleCfg.requires_evidence) {
        result.result = "fail";
        result.missing_evidence = true;
        result.message =
          "Required evidence for signed artifacts missing (integrity.signed_artifacts not present).";
      } else {
        result.result = "warn";
        result.missing_evidence = true;
        result.message =
          "Signed artifacts status missing; treating as warning because requires_evidence=false.";
      }
      return result;
    }

    ok = val === true;
    if (ok) {
      result.result = "pass";
      result.message = "Release artifacts are signed as required.";
    } else {
      result.result = "fail";
      result.message = "Release artifacts are not signed, but policy requires signatures.";
    }
    return result;
  }

  if (ruleId === "integrity.sbom") {
    const val = integrity.sbom_present;
    hasEvidence = typeof val === "boolean";
    if (!hasEvidence) {
      if (ruleCfg.requires_evidence) {
        result.result = "fail";
        result.missing_evidence = true;
        result.message =
          "Required SBOM evidence missing (integrity.sbom_present not present).";
      } else {
        result.result = "warn";
        result.missing_evidence = true;
        result.message =
          "SBOM presence status missing; treating as warning because requires_evidence=false.";
      }
      return result;
    }

    ok = val === true;
    if (ok) {
      result.result = "pass";
      result.message = "SBOM is present for this release, as required.";
    } else {
      result.result = "fail";
      result.message = "SBOM is missing, but policy requires SBOM for releases.";
    }
    return result;
  }

  // Fallback: unknown integrity rule
  result.result = "warn";
  result.message =
    `No specific evaluator implemented for integrity rule '${ruleId}'; skipping with warning.`;
  return result;
}

/**
 * Apply waivers to a per-rule result:
 *  - If rule.result === "fail" AND there is at least one active waiver:
 *      - mark rule.waived = true
 *      - keep result as "fail" OR optionally downgrade to "warn"
 *    For PIPE-GOV-8.1 semantics we:
 *      - set waived = true
 *      - keep result = "fail", but **overall status logic treats waived fails as non-blocking**
 */
function applyWaiversToRule(ruleResult, activeWaivers) {
  if (ruleResult.result !== "fail" || activeWaivers.length === 0) {
    return ruleResult;
  }

  // Mutate in-place for simplicity
  ruleResult.waived = true;
  ruleResult.message +=
    ` (Violation waived by ${activeWaivers.length} active waiver(s).)`;

  return ruleResult;
}

/**
 * Compute overall score using a simple heuristic:
 *  - Start at 50
 *  - For each rule:
 *      block + pass → +10
 *      block + warn/fail → -20
 *      warn  + pass → +5
 *      warn  + warn/fail → 0
 *      info  → ignored
 *  - Clamp to [0, 100]
 */
function computeScore(ruleResults) {
  let score = 50;

  for (const r of ruleResults) {
    const severity = r.severity || "block";
    const res = r.result || "pass";

    if (severity === "block") {
      if (res === "pass") score += 10;
      else score -= 20;
    } else if (severity === "warn") {
      if (res === "pass") score += 5;
      // warn/fail → no change
    } else {
      // info rules ignored
    }
  }

  if (score < 0) score = 0;
  if (score > 100) score = 100;
  return score;
}

/**
 * Evaluate all rules defined in policy.rules against aggregated inputs.
 *
 * policy.rules shape:
 *   {
 *     "coverage.min": {
 *       "severity": "block",
 *       "requires_evidence": true,
 *       "threshold": 80
 *     },
 *     "tests.green": {
 *       "severity": "block",
 *       "requires_evidence": true
 *     },
 *     ...
 *   }
 *
 * Returns:
 *   {
 *     status: "passed" | "passed_with_warnings" | "failed",
 *     score: number,
 *     rules: [... per-rule results ...],
 *     waivers_used: [...],
 *     missing_evidence: [... ruleIds ...],
 *     timestamp: ISO-8601,
 *     policy_version: string | null
 *   }
 */
export function evaluatePolicyGate(policy, inputs, waivers = []) {
  const rulesConfig = policy?.rules || {};
  const ruleIds = Object.keys(rulesConfig);

  const allWaivers = normalizeWaivers(waivers);
  const ruleResults = [];
  const missingEvidenceIds = [];
  const waiversUsed = [];

  for (const ruleId of ruleIds) {
    const cfg = rulesConfig[ruleId] || {};
    let result;

    if (ruleId === "tests.green") {
      result = evaluateTestsGreen(ruleId, cfg, inputs);
    } else if (ruleId === "coverage.min") {
      result = evaluateCoverageMin(ruleId, cfg, inputs);
    } else if (ruleId.startsWith("security.")) {
      result = evaluateSecurityRule(ruleId, cfg, inputs);
    } else if (ruleId === "adr.required_for_infra") {
      result = evaluateAdrRequired(ruleId, cfg, inputs);
    } else if (
      ruleId === "supplychain.signed" ||
      ruleId === "integrity.signed" ||
      ruleId === "integrity.sbom"
    ) {
      result = evaluateIntegrityRule(ruleId, cfg, inputs);
    } else {
      // Unknown rule → warn but do not block
      result = {
        id: ruleId,
        severity: cfg.severity || "info",
        result: "warn",
        message: `No evaluator implemented for rule '${ruleId}'. Please add logic or remove rule.`,
        evidence: null,
        missing_evidence: false,
        waived: false
      };
    }

    if (result.missing_evidence) {
      missingEvidenceIds.push(ruleId);
    }

    const activeWaivers = getActiveWaiversForRule(allWaivers, ruleId);
    if (activeWaivers.length > 0) {
      waiversUsed.push(...activeWaivers);
      applyWaiversToRule(result, activeWaivers);
    }

    ruleResults.push(result);
  }

  // Overall status:
  //  - Any block fail (not waived) → failed
  //  - Else if any rule result != "pass" → passed_with_warnings
  //  - Else → passed
  let hasUnwaivedBlockFail = false;
  let hasNonPass = false;

  for (const r of ruleResults) {
    if (r.result !== "pass") {
      hasNonPass = true;
    }
    if (r.severity === "block" && r.result === "fail" && !r.waived) {
      hasUnwaivedBlockFail = true;
      break;
    }
  }

  let status;
  if (hasUnwaivedBlockFail) status = "failed";
  else if (hasNonPass) status = "passed_with_warnings";
  else status = "passed";

  const score = computeScore(ruleResults);

  return {
    status,
    score,
    rules: ruleResults,
    waivers_used: waiversUsed,
    missing_evidence: missingEvidenceIds,
    timestamp: new Date().toISOString(),
    policy_version: policy?.policy_version || null
  };
}

/**
 * CLI entrypoint.
 *
 * Usage:
 *   node scripts/policy/gate-engine.mjs \
 *     --policy out/effective-policy.json \
 *     --inputs out/inputs.json \
 *     --waivers out/waivers.json \
 *     --out out/decision.json
 */
async function main() {
  const args = parseArgs(process.argv);

  const policyPath = args.policy || "out/effective-policy.json";
  const inputsPath = args.inputs || "out/inputs.json";
  const waiversPath = args.waivers || "out/waivers.json";
  const outPath = args.out || "out/decision.json";

  if (!fs.existsSync(policyPath)) {
    throw new Error(`Policy file not found at ${policyPath}`);
  }
  if (!fs.existsSync(inputsPath)) {
    throw new Error(`Inputs file not found at ${inputsPath}`);
  }

  const policy = loadJsonOrYaml(policyPath);
  const inputs = loadJsonOrYaml(inputsPath);
  let waivers = [];
  if (fs.existsSync(waiversPath)) {
    waivers = loadJsonOrYaml(waiversPath);
  }

  const decisionCore = evaluatePolicyGate(policy, inputs, waivers || []);

  // You can embed meta/inputs if desired; for now, keep decision.json focused.
  const decision = {
    ...decisionCore,
    meta: inputs.meta || {}
  };

  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(outPath, JSON.stringify(decision, null, 2) + "\n", "utf8");

  // For GitHub Actions: echo outputs
  // status + score as workflow outputs (when called via node20 action)
  // NOTE: When used as a plain CLI, this stdout is harmless.
  console.log(`policy-gate status=${decision.status}`);
  console.log(`policy-gate score=${decision.score}`);
}

// Run only when executed directly (not when imported in tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(
      `policy-gate: unexpected error during evaluation: ${err.message}`
    );
    process.exit(1);
  });
}
