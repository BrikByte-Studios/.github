/**
 * BrikByte Studios — Governance Gather Helpers (PIPE-GOV-7.3.x)
 *
 * This file is responsible for reading raw artefacts from CI (reports, logs, etc.)
 * and normalizing them into structured JSON that evaluation functions can consume.
 *
 * Currently covers:
 *  - Security:
 *      - SAST and SCA reports based on policy.security.sast/sca.report_path
 *      - Normalises tool-specific severities into the standard scale:
 *          none < low < medium < high < critical
 *      - Produces compact summaries suitable for decision.json
 *
 *  - Artifact Integrity (via gather-artifacts.mjs):
 *      - SBOM presence
 *      - Hash manifest presence + basic validity
 *      - Signature verification status
 */


import fs from "node:fs";
import path from "node:path";
import { SECURITY_SEVERITIES } from "./security-severity.mjs";
import { gatherArtifactIntegrity } from "./gather-artifacts.mjs";

/**
 * Map various tool-specific severity labels into our canonical set.
 * This keeps evaluation logic simple and centralised.
 */
function normalizeSeverity(raw) {
  if (!raw) return "none";
  const s = String(raw).toLowerCase();

  // Common mappings (CodeQL, Semgrep, npm-audit, etc.)
  if (s === "note" || s === "info" || s === "informational") return "low";
  if (s === "warning" || s === "warn" || s === "moderate") return "medium";
  if (s === "error") return "high";

  if (SECURITY_SEVERITIES.includes(s)) {
    return s;
  }

  // Fallback to medium if unknown
  return "medium";
}

/**
 * Initialise a severity-count object with all severities present.
 */
function emptySeverityCounts() {
  const counts = {};
  for (const sev of SECURITY_SEVERITIES) {
    counts[sev] = 0;
  }
  return counts;
}

/**
 * Given an array of "findings" objects with a "severity" field,
 * create a standardised severity-count map.
 *
 * @param {Array<{severity:string}>} findings
 * @returns {{none:number, low:number, medium:number, high:number, critical:number}}
 */
function countBySeverity(findings = []) {
  const counts = emptySeverityCounts();

  for (const finding of findings) {
    const sev = normalizeSeverity(finding.severity);
    counts[sev] = (counts[sev] || 0) + 1;
  }

  return counts;
}

/**
 * Attempt to read a JSON report from the given path.
 * Throws a descriptive error if file is missing or invalid.
 */
function readJsonReport(reportPath) {
  const raw = fs.readFileSync(reportPath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Unable to parse JSON report at ${reportPath}: ${err.message}`);
  }
}

/**
 * Extract findings from a simple, normalised report structure.
 *
 * IMPORTANT: For v1, we assume the report has a "results" or "vulnerabilities"
 * array with objects containing a "severity" field.
 *
 * This keeps the gate simple and tool-agnostic. If you need richer SARIF
 * parsing later, you can add a tool-specific adapter here.
 */
function extractFindingsForTool(reportJson, toolType, toolName) {
  if (!reportJson) return [];

  // Try common fields first
  if (Array.isArray(reportJson.results)) {
    return reportJson.results.map((r) => ({
      severity: r.severity || r.level || r.severityLevel || "medium"
    }));
  }

  if (Array.isArray(reportJson.vulnerabilities)) {
    return reportJson.vulnerabilities.map((v) => ({
      severity: v.severity || v.level || v.severityLevel || "medium"
    }));
  }

  // Fallback: if nothing recognised, treat whole report as a single medium issue.
  return [
    {
      severity: "medium",
      _note: `Unrecognised ${toolType} report shape for tool "${toolName}", defaulting to single medium finding.`
    }
  ];
}

/**
 * Gather SAST findings based on policy.security.sast.* configuration.
 *
 * @param {object} policy Effective merged policy
 * @param {string} workspaceRoot CI workspace root (usually process.cwd())
 */
export function gatherSastFindings(policy, workspaceRoot = process.cwd()) {
  const sastConfig = policy?.security?.sast;
  if (!sastConfig || !sastConfig.report_path) {
    return null;
  }

  const tool = sastConfig.tool || "unknown-sast-tool";
  const reportPath = path.resolve(workspaceRoot, sastConfig.report_path);

  if (!fs.existsSync(reportPath)) {
    throw new Error(
      `SAST report not found at ${reportPath}. Check security.sast.report_path in policy.yml.`
    );
  }

  const reportJson = readJsonReport(reportPath);
  const findings = extractFindingsForTool(reportJson, "sast", tool);
  const counts = countBySeverity(findings);

  return {
    tool,
    report_path: sastConfig.report_path,
    counts
  };
}

/**
 * Gather SCA findings based on policy.security.sca.* configuration.
 *
 * @param {object} policy Effective merged policy
 * @param {string} workspaceRoot CI workspace root (usually process.cwd())
 */
export function gatherScaFindings(policy, workspaceRoot = process.cwd()) {
  const scaConfig = policy?.security?.sca;
  if (!scaConfig || !scaConfig.report_path) {
    return null;
  }

  const tool = scaConfig.tool || "unknown-sca-tool";
  const reportPath = path.resolve(workspaceRoot, scaConfig.report_path);

  if (!fs.existsSync(reportPath)) {
    throw new Error(
      `SCA report not found at ${reportPath}. Check security.sca.report_path in policy.yml.`
    );
  }

  const reportJson = readJsonReport(reportPath);
  const findings = extractFindingsForTool(reportJson, "sca", tool);
  const counts = countBySeverity(findings);

  return {
    tool,
    report_path: scaConfig.report_path,
    counts
  };
}

/**
 * High-level helper used by the gate to gather all security-related inputs.
 *
 * Returns:
 * {
 *   sast: { tool, report_path, counts },
 *   sca:  { tool, report_path, counts }
 * }
 */
export function gatherSecurityFindings(policy, workspaceRoot = process.cwd()) {
  const sast = gatherSastFindings(policy, workspaceRoot);
  const sca = gatherScaFindings(policy, workspaceRoot);

  return { sast, sca };
}

/**
 * High-level helper to gather ALL governance-related inputs that
 * other evaluators expect:
 *
 *  - security: SAST + SCA severity summaries
 *  - artifacts: SBOM/hash/signature integrity metadata
 *
 * This is a convenience wrapper so gate orchestration code can do:
 *
 *   const { security, artifacts } = gatherGovernanceInputs(policy);
 *
 * @param {object} policy        Effective merged policy (org+repo)
 * @param {string} workspaceRoot CI workspace root (defaults to process.cwd())
 * @param {object} env           Environment variables (defaults to process.env)
 * @returns {{ security: {sast: object|null, sca: object|null}, artifacts: object }}
 */
export function gatherGovernanceInputs(
  policy,
  workspaceRoot = process.cwd(),
  env = process.env
) {
  const security = gatherSecurityFindings(policy, workspaceRoot);
  const artifacts = gatherArtifactIntegrity({
    policy,
    workspaceRoot,
    env
  });

  return { security, artifacts };
}


