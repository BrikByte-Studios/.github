#!/usr/bin/env node
/**
 * BrikByte Studios — Human-Readable Governance Summary (PIPE-GOV-8.2)
 *
 * Responsibilities:
 *  - Read decision.json produced by PIPE-GOV-8.1 (gate-engine).
 *  - Render a canonical Markdown summary with:
 *      - Overall status header (status emoji + env/branch + policy version + score).
 *      - Rule Results table.
 *      - Recommended Fixes section.
 *      - Evidence & Links section.
 *  - Write the Markdown to an output file (e.g. out/summary.md).
 *  - Print the same Markdown to stdout for CI log visibility.
 *
 * This script does NOT re-evaluate policy. It is a pure view layer on top of
 * decision.json, which is the single source of truth.
 *
 * Usage:
 *   node scripts/policy/summary.mjs \
 *     --decision out/decision.json \
 *     --out out/summary.md
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Tiny CLI argument parser.
 *
 * Supports:
 *   --decision PATH
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
 * Load JSON from a file path.
 *
 * Throws a descriptive error if parsing fails.
 */
function loadJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Unable to parse JSON at "${filePath}": ${err.message}`);
  }
}

/**
 * Map gate status → emoji + human label.
 */
function formatStatus(status) {
  switch (status) {
    case "passed":
      return { emoji: "✅", label: "Passed" };
    case "passed_with_warnings":
      return { emoji: "⚠️", label: "Passed with Warnings" };
    case "failed":
      return { emoji: "❌", label: "Failed" };
    default:
      return { emoji: "❓", label: status || "Unknown" };
  }
}

/**
 * Map per-rule result → emoji + label for table.
 */
function formatRuleResult(result) {
  switch (result) {
    case "pass":
      return "✅ Pass";
    case "warn":
      return "⚠️ Warn";
    case "fail":
      return "❌ Fail";
    default:
      return result || "unknown";
  }
}

/**
 * Truncate a string to a maximum length, adding ellipsis if needed.
 */
function truncate(str, maxLen) {
  if (!str) return "";
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1).trimEnd() + "…";
}

/**
 * Very small heuristic to check if a string "looks like" a URL.
 */
function looksLikeUrl(value) {
  if (typeof value !== "string") return false;
  return value.startsWith("http://") || value.startsWith("https://");
}

/**
 * Default remediation hints for common rule IDs when rule.remediation_hint
 * is not provided in decision.json.
 */
const DEFAULT_REMEDIATION_HINTS = {
  "tests.green":
    "Fix failing tests and ensure all required test suites pass in CI.",
  "coverage.min":
    "Increase automated test coverage to meet or exceed the required threshold, focusing on critical modules.",
  "security.sca":
    "Address vulnerable dependencies by upgrading, replacing, or mitigating with compensating controls.",
  "security.sast":
    "Fix or suppress (with justification) static analysis findings above the allowed severity.",
  "adr.required_for_infra":
    "Author or update an ADR for this change and reference it in the PR description.",
  "supplychain.signed":
    "Ensure release artifacts are signed and that signature verification runs in CI for this pipeline.",
  "integrity.sbom":
    "Generate and publish an SBOM for this build and export it as a CI artifact.",
};

/**
 * Get a remediation hint for a specific rule, preferring:
 *   1) rule.remediation_hint from decision.json (if present)
 *   2) DEFAULT_REMEDIATION_HINTS[rule.id]
 *   3) A generic fallback message.
 */
function getRemediationHint(rule) {
  if (rule && typeof rule.remediation_hint === "string") {
    return rule.remediation_hint;
  }
  if (rule && DEFAULT_REMEDIATION_HINTS[rule.id]) {
    return DEFAULT_REMEDIATION_HINTS[rule.id];
  }
  return "Review this rule’s message and evidence, then address the underlying issue.";
}

/**
 * Build an array of recommended fixes based on rule outcomes.
 *
 * Rules included:
 *  - result === "fail"
 *  - OR (result === "warn" && severity === "block")
 */
function buildRecommendedFixes(decision) {
  const rules = Array.isArray(decision.rules) ? decision.rules : [];
  const fixes = [];

  for (const r of rules) {
    const severity = r.severity || "block";
    const result = r.result || "pass";

    const isFail = result === "fail";
    const isSeriousWarn = result === "warn" && severity === "block";

    if (!isFail && !isSeriousWarn) continue;

    const hint = getRemediationHint(r);

    let suffix = "";
    if (looksLikeUrl(r.evidence)) {
      // We deliberately keep this simple and human-friendly.
      suffix = ` (Evidence: ${r.evidence})`;
    }

    fixes.push({
      ruleId: r.id || "unknown",
      text: `**${r.id || "unknown"}** — ${hint}${suffix}`,
    });
  }

  return fixes;
}

/**
 * Collect evidence links from rule.evidence fields.
 *
 * Returns an array of:
 *   { ruleId, url }
 */
function collectEvidenceLinks(decision) {
  const rules = Array.isArray(decision.rules) ? decision.rules : [];
  const links = [];
  const seen = new Set();

  for (const r of rules) {
    const url = r.evidence;
    if (!looksLikeUrl(url)) continue;
    const key = `${r.id}:${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ ruleId: r.id || "unknown", url });
  }

  return links;
}

/**
 * Render the full Markdown summary as a single string.
 *
 * This function is pure and does not touch the filesystem, which makes it
 * directly testable via unit tests or golden snapshots.
 *
 * @param {object} decision - decision.json payload
 * @param {object} options
 * @param {string} [options.decisionPath] - Path to the decision.json file (for Evidence section).
 */
export function renderSummary(decision, { decisionPath } = {}) {
  const statusRaw = decision.status || "unknown";
  const { emoji: statusEmoji, label: statusLabel } = formatStatus(statusRaw);
  const policyVersion = decision.policy_version || "unknown";
  const score =
    typeof decision.score === "number" ? `${decision.score}/100` : "N/A";

  const meta = decision.meta || {};
  const targetEnv = meta.target_env || "unknown";
  const branch = meta.branch || "unknown";

  const rules = Array.isArray(decision.rules) ? decision.rules : [];
  const waiversUsed = Array.isArray(decision.waivers_used)
    ? decision.waivers_used
    : [];
  const missingEvidence = Array.isArray(decision.missing_evidence)
    ? decision.missing_evidence
    : [];

  // -----------------------------
  // Header / Overall status block
  // -----------------------------
  let md = "";
  md += "## Governance Summary (policy-gate)\n\n";
  md += `**Overall Status:** ${statusEmoji} ${statusLabel}  \n`;
  md += `**Policy Version:** v${policyVersion}  \n`;
  md += `**Target Env:** ${targetEnv} • **Branch:** ${branch} • **Score:** ${score}\n\n`;
  md += "---\n\n";

  // -----------------------------
  // Rule Results table
  // -----------------------------
  md += "### Rule Results\n\n";

  if (rules.length === 0) {
    md += "_No rules were evaluated._\n\n";
  } else {
    md += "| Rule ID | Severity | Result | Waived | Details |\n";
    md += "|---------|----------|--------|--------|---------|\n";

    for (const r of rules) {
      const id = r.id || "unknown";
      const severity = r.severity || "info";
      const result = formatRuleResult(r.result || "pass");
      const waived = r.waived ? "✅ Yes" : "❌ No";

      let details = r.message || "";
      details = truncate(details, 120);

      if (looksLikeUrl(r.evidence)) {
        // Lightweight hint that evidence exists; not a full link to keep it compact.
        details = details
          ? `${details} 🔗`
          : `Evidence available at ${r.evidence} 🔗`;
      }

      // Escape pipe characters minimally to avoid breaking the table.
      const esc = (value) =>
        String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

      md += `| ${esc(id)} | ${esc(severity)} | ${esc(
        result
      )} | ${esc(waived)} | ${esc(details)} |\n`;
    }

    md += "\n";
  }

  // -----------------------------
  // Recommended Fixes
  // -----------------------------
  md += "### Recommended Fixes\n\n";

  const fixes = buildRecommendedFixes(decision);
  if (fixes.length === 0) {
    md += "No action required — all governance rules passed.\n\n";
  } else {
    fixes.forEach((f, idx) => {
      md += `${idx + 1}. ${f.text}\n`;
    });
    md += "\n";
  }

  // -----------------------------
  // Evidence & Links
  // -----------------------------
  md += "### Evidence & Links\n\n";

  if (decisionPath) {
    md += `- Decision JSON: \`${decisionPath}\`\n`;
  }

  const evidenceLinks = collectEvidenceLinks(decision);
  if (evidenceLinks.length > 0) {
    for (const link of evidenceLinks) {
      md += `- ${link.ruleId}: ${link.url}\n`;
    }
  }

  if (!decisionPath && evidenceLinks.length === 0) {
    md += "_No evidence links were provided in decision.json._\n";
  }

  // Missing evidence section (if any rules flagged missing_evidence)
  if (missingEvidence.length > 0) {
    md += "\n> ⚠️ Missing evidence for rules: ";
    md += missingEvidence.join(", ");
    md +=
      ". These rules may be treated as hard failures depending on requires_evidence semantics.\n";
  }

  md += "\n";
  return md;
}

/**
 * CLI entrypoint.
 *
 * Reads decision.json, renders Markdown summary, writes it to --out, and prints
 * it to stdout.
 */
async function main() {
  const args = parseArgs(process.argv);
  const decisionPath = args.decision || "out/decision.json";
  const outPath = args.out || "out/summary.md";

  if (!fs.existsSync(decisionPath)) {
    throw new Error(
      `Decision file not found at "${decisionPath}". Ensure PIPE-GOV-8.1 has produced decision.json.`
    );
  }

  const decision = loadJson(decisionPath);
  const markdown = renderSummary(decision, { decisionPath });

  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outPath, markdown + "\n", "utf8");

  // Print to stdout so the summary is visible in CI logs.
  console.log(markdown);
}

// Run only when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(
      `summary: unexpected error while generating governance summary: ${err.message}`
    );
    process.exit(1);
  });
}
