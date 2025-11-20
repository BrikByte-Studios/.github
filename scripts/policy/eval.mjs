/**
 * BrikByte Studios — Security & ADR Evaluation (PIPE-GOV-7.3.3 + 7.3.4)
 *
 * Evaluates:
 *  - SAST & SCA severity thresholds using:
 *      policy.security.sast/sca.max_severity
 *      gathered findings (counts by severity)
 *      optional waivers from policy.waivers (time-bound, rule-scoped)
 *
 *  - ADR & documentation checks using:
 *      policy.adr (required_on_paths, require_accepted_adr, adr_file_glob)
 *      changed files & PR body from gather step
 *      ADR metadata & schema validation from ADR tooling
 *
 * Primary exports:
 *   - evaluateSecurity({ policy, securityFindings, decision })
 *       -> { decision, hasUnwaivedFailures }
 *
 *   - evaluateSecurityAndAdr({ policy, securityFindings, adrContext, decision })
 *       -> { decision, hasUnwaivedFailures }
 *
 * Utility exports:
 *   - loadDecision(decisionPath)
 *   - saveDecision(decisionPath, decision)
 */

import fs from "node:fs";
import { severityToRank, highestSeverityFromCounts } from "./security-severity.mjs";
import { evaluateAdrGate } from "./eval-adr.mjs";
import { evaluateArtifacts } from "./eval-artifacts.mjs";

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
 *
 * @param {object} waiver
 * @returns {boolean}
 */
function isWaiverActive(waiver) {
  const ttlDate = parseDate(waiver.ttl);
  if (!ttlDate) return false;
  const now = new Date();
  return now.getTime() <= ttlDate.getTime();
}

/**
 * Find waivers applicable to a particular rule, e.g. "security.sast" or "security.sca".
 *
 * @param {object} policy
 * @param {string} ruleName
 * @returns {Array<object>}
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
 * @param {object} params.config           Effective policy.security[kind]
 * @param {object|null} params.findings    Output of gatherSecurityFindings[kind]
 * @param {Array<object>} params.waivers   Applicable waivers for this rule
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

  // If no config or no findings, treat as pass with informational reason.
  if (!config || !findings) {
    result.reason = "No findings or configuration present for this security domain.";
    return result;
  }

  const highestSeverity = highestSeverityFromCounts(findings.counts);
  result.highest_severity = highestSeverity;

  const maxAllowed = config.max_severity;
  const highestRank = severityToRank(highestSeverity);
  const maxRank = severityToRank(maxAllowed);

  // Within allowed threshold → pass
  if (highestRank <= maxRank) {
    result.result = "pass";
    result.reason = `Highest ${kind.toUpperCase()} severity "${highestSeverity}" is within allowed maximum "${maxAllowed}".`;
    return result;
  }

  // At this point, there is at least one finding above allowed severity.
  // Look for waivers for this rule. v1: we only check rule-level waivers,
  // not per-CVE/per-query; scope-based refinement can be added later.
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
 * @param {object} params.policy          Effective merged policy (org+repo)
 * @param {object} params.securityFindings { sast, sca } from gatherSecurityFindings()
 * @param {object} params.decision        Existing decision object (will be mutated / extended)
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
 * Combined helper: evaluate security (SAST/SCA) **and** ADR gate in one shot.
 *
 * This is convenient for a "single-step" governance gate CLI where you:
 *  - Load merged policy (org+repo)
 *  - Load security findings from artifacts
 *  - Load ADR context from gather step
 *  - Load an existing decision.json (if present)
 *
 * Then call:
 *
 *   const { decision, hasUnwaivedFailures } = evaluateSecurityAndAdr({
 *     policy,
 *     securityFindings,
 *     adrContext,
 *     decision
 *   });
 *
 * and finally write decision.json + set CI pass/fail based on hasUnwaivedFailures.
 *
 * @param {object} params
 * @param {object} params.policy           Effective merged policy
 * @param {object} params.securityFindings { sast, sca }
 * @param {object} params.adrContext       Passed directly to evaluateAdrGate()
 * @param {object} [params.decision]       Existing decision object (optional)
 * @returns {{ decision: object, hasUnwaivedFailures: boolean }}
 */
export function evaluateSecurityAndAdr({
  policy,
  securityFindings,
  adrContext,
  decision
}) {
  // 1) Run security evaluation first
  const { decision: afterSecurity, hasUnwaivedFailures: secFail } =
    evaluateSecurity({ policy, securityFindings, decision });

  // 2) Run ADR gate using policy.adr + context (changed files, PR body, ADR metadata)
  const adrConfig = policy?.adr || {};

  // Ensure waivers are carried into ADR context; ADR gate expects waivers inside context.
  const adrWithWaivers = {
    ...(adrContext || {}),
    waivers: policy?.waivers || []
  };

  const adrDecision = evaluateAdrGate(adrConfig, adrWithWaivers);

  const combinedDecision = {
    ...afterSecurity,
    adr: adrDecision
  };

  const hasAdrUnwaivedFailure = adrDecision.result === "fail";
  const hasUnwaivedFailures = secFail || hasAdrUnwaivedFailure;

  return { decision: combinedDecision, hasUnwaivedFailures };
}


/**
 * Full-stack evaluator: Security + ADR + Artifact Integrity.
 *
 * Use this in your main policy gate CLI to cover:
 *  - SAST/SCA thresholds (PIPE-GOV-7.3.3)
 *  - ADR/doc checks (PIPE-GOV-7.3.4)
 *  - Artifact integrity (PIPE-GOV-7.3.5)
 *
 * Typical usage:
 *
 *   const { decision, hasUnwaivedFailures } = evaluateSecurityAdrAndArtifacts({
 *     policy,
 *     securityFindings,
 *     adrContext,
 *     artifactIntegrity,
 *     branch: process.env.GITHUB_REF_NAME,
 *     targetEnv: process.env.TARGET_ENV,
 *     decision: existingDecision
 *   });
 *
 * @param {object} params
 * @param {object} params.policy             Effective merged policy
 * @param {object} params.securityFindings   { sast, sca } from gatherSecurityFindings()
 * @param {object} params.adrContext         Context for ADR gate (files changed, PR body, ADR metadata)
 * @param {object} params.artifactIntegrity  Output from gatherArtifactIntegrity()
 * @param {string} params.branch             Target branch name (e.g. "main", "release/v1.2.3")
 * @param {string} [params.targetEnv]        Target environment (e.g. "prod", "staging")
 * @param {object} [params.decision]         Existing decision object (optional)
 * @returns {{ decision: object, hasUnwaivedFailures: boolean }}
 */
export function evaluateSecurityAdrAndArtifacts({
  policy,
  securityFindings,
  adrContext,
  artifactIntegrity,
  branch,
  targetEnv,
  decision
}) {
  // 1) Security + ADR
  const {
    decision: afterSecAdr,
    hasUnwaivedFailures: hasSecAdrFailures
  } = evaluateSecurityAndAdr({
    policy,
    securityFindings,
    adrContext,
    decision
  });

  // 2) Artifact integrity gate (PIPE-GOV-7.3.5)
  const {
    decision: afterArtifacts,
    hasUnwaivedFailures: hasArtifactFailures
  } = evaluateArtifacts({
    policy,
    artifactIntegrity,
    branch,
    targetEnv,
    decision: afterSecAdr
  });

  const hasUnwaivedFailures = hasSecAdrFailures || hasArtifactFailures;

  return { decision: afterArtifacts, hasUnwaivedFailures };
}

/**
 * Utility to load an existing decision.json from disk.
 * If file is missing, returns an empty object.
 *
 * @param {string} decisionPath
 * @returns {object}
 */
export function loadDecision(decisionPath) {
  if (!fs.existsSync(decisionPath)) {
    return {};
  }
  const raw = fs.readFileSync(decisionPath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Unable to parse decision.json at ${decisionPath}: ${err.message}`
    );
  }
}

/**
 * Utility to write decision.json back to disk (pretty-printed).
 *
 * @param {string} decisionPath
 * @param {object} decision
 */
export function saveDecision(decisionPath, decision) {
  const json = JSON.stringify(decision, null, 2);
  fs.writeFileSync(decisionPath, json + "\n", "utf8");
}
