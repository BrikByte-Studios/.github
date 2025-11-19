/**
 * BrikByte Studios — Security Evaluation (PIPE-GOV-7.3.3)
 *
 * Evaluates SAST and SCA severity thresholds using:
 *  - policy.security.sast/sca.max_severity
 *  - gathered findings (counts by severity)
 *  - optional waivers from policy.waivers (time-bound, rule-scoped)
 *
 * Writes results into decision.security and returns:
 *   { decision, hasUnwaivedFailures }
 */

import fs from "node:fs";
import { severityToRank, highestSeverityFromCounts } from "./security-severity.mjs";

/**
 * Parse yyyy-mm-dd into a Date. Returns null if invalid.
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
 * Find waivers applicable to a particular rule, e.g. "security.sast" or "security.sca".
 */
function findWaiversForRule(policy, ruleName) {
  const waivers = Array.isArray(policy?.waivers) ? policy.waivers : [];
  return waivers.filter((w) => w.rule === ruleName && isWaiverActive(w));
}

/**
 * Evaluate a single security domain (SAST or SCA).
 *
 * @param {object} params
 * @param {"sast"|"sca"} params.kind
 * @param {object} params.config  Effective policy.security[kind]
 * @param {object|null} params.findings  Output of gatherSecurityFindings[kind]
 * @param {Array<object>} params.waivers Applicable waivers for this rule
 */
function evaluateSecurityDomain({ kind, config, findings, waivers }) {
  const ruleName = `security.${kind}`;
  const result = {
    tool: config?.tool || `unknown-${kind}-tool`,
    max_severity: config?.max_severity || "critical",
    counts: findings?.counts || {
      none: 0,
      low: 0,
      medium: 0,
      high: 0,
      critical: 0
    },
    report_path: findings?.report_path || null,
    result: "pass", // pass | fail | fail_waived
    reason: "",
    waivers_applied: []
  };

  // If no config or no findings, we treat as pass with empty info.
  if (!config || !findings) {
    result.reason = "No findings or configuration present for this security domain.";
    return result;
  }

  const highestSeverity = highestSeverityFromCounts(findings.counts);
  result.highest_severity = highestSeverity;

  const maxAllowed = config.max_severity;
  const highestRank = severityToRank(highestSeverity);
  const maxRank = severityToRank(maxAllowed);

  if (highestRank <= maxRank) {
    result.result = "pass";
    result.reason = `Highest ${kind.toUpperCase()} severity "${highestSeverity}" is within allowed maximum "${maxAllowed}".`;
    return result;
  }

  // At this point, there is at least one unwaived finding above allowed severity.
  // Look for waivers for this rule. v1: we only check rule-level waivers,
  // not per-CVE/per-query. You can refine this later by matching scope.
  const activeWaivers = Array.isArray(waivers) ? waivers : [];

  if (activeWaivers.length === 0) {
    result.result = "fail";
    result.reason = `Found ${kind.toUpperCase()} findings with severity "${highestSeverity}" above allowed maximum "${maxAllowed}" and no active waivers for ${ruleName}.`;
    return result;
  }

  // Rule has at least one active waiver. Mark as fail_waived.
  result.result = "fail_waived";
  result.reason = `Found ${kind.toUpperCase()} findings with severity "${highestSeverity}" above allowed maximum "${maxAllowed}", but violation is covered by active waiver(s) for ${ruleName}.`;
  result.waivers_applied = activeWaivers;

  return result;
}

/**
 * Evaluate security thresholds for both SAST and SCA, update decision.json structure.
 *
 * @param {object} params
 * @param {object} params.policy       Effective merged policy (org+repo)
 * @param {object} params.securityFindings { sast, sca } from gatherSecurityFindings()
 * @param {object} params.decision     Existing decision object (will be mutated)
 * @returns {{ decision: object, hasUnwaivedFailures: boolean }}
 */
export function evaluateSecurity({ policy, securityFindings, decision }) {
  const securityConfig = policy?.security || {};
  const sastConfig = securityConfig.sast || null;
  const scaConfig = securityConfig.sca || null;

  const sastWaivers = findWaiversForRule(policy, "security.sast");
  const scaWaivers = findWaiversForRule(policy, "security.sca");

  const sastEval = evaluateSecurityDomain({
    kind: "sast",
    config: sastConfig,
    findings: securityFindings?.sast || null,
    waivers: sastWaivers
  });

  const scaEval = evaluateSecurityDomain({
    kind: "sca",
    config: scaConfig,
    findings: securityFindings?.sca || null,
    waivers: scaWaivers
  });

  const securitySection = {
    sast: sastEval,
    sca: scaEval
  };

  const nextDecision = {
    ...(decision || {}),
    security: securitySection
  };

  const hasUnwaivedFailures =
    sastEval.result === "fail" || scaEval.result === "fail";

  return { decision: nextDecision, hasUnwaivedFailures };
}

/**
 * Utility to load an existing decision.json from disk.
 * If file is missing, returns an empty object.
 */
export function loadDecision(decisionPath) {
  if (!fs.existsSync(decisionPath)) {
    return {};
  }
  const raw = fs.readFileSync(decisionPath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Unable to parse decision.json at ${decisionPath}: ${err.message}`);
  }
}

/**
 * Utility to write decision.json back to disk (pretty-printed).
 */
export function saveDecision(decisionPath, decision) {
  const json = JSON.stringify(decision, null, 2);
  fs.writeFileSync(decisionPath, json + "\n", "utf8");
}
