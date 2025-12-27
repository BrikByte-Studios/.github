/**
 * =============================================================================
 * BrikByteOS — Flaky Policy Evaluator (v1)
 * -----------------------------------------------------------------------------
 * Task: PIPE-FLAKY-POLICY-CONFIG-002 — Implement Threshold-Based Failure Rule
 *
 * What this does:
 *   - Loads policy-as-code from .governance/flaky-tests.yml (schema v1)
 *   - Loads repeat-run evidence summary JSON from out/flaky/summary.json
 *   - Computes deterministic fail_rate = fail_count / total_attempts
 *   - Classifies suite as:
 *       pass (fail_rate == 0)
 *       informational (0 < fail_rate < flaky_threshold)
 *       flaky (fail_rate >= flaky_threshold and < quarantine_threshold)
 *       quarantine-candidate (fail_rate >= quarantine_threshold; only “actionable”
 *                           when quarantine_enabled=true)
 *   - Emits:
 *       out/flaky/evaluation.json (always)
 *       out/flaky/evaluation.md   (optional via --md)
 *   - Exits non-zero ONLY when:
 *       policy.enabled=true AND policy.block_merge=true AND
 *       classification in {flaky, quarantine-candidate}
 *
 * Why:
 *   - Ensures “flaky noise” is governed and consistent across repos.
 *   - Default remains warn-only unless policy explicitly enables blocking.
 *
 * CLI:
 *   node .github/scripts/evaluate-flaky.ts \
 *     --policy .governance/flaky-tests.yml \
 *     --input out/flaky/summary.json \
 *     --out out/flaky/evaluation.json \
 *     --md
 *
 * Notes:
 *   - v1 scope is "suite" only.
 *   - No auto-quarantine mutations in v1; only guidance output.
 * =============================================================================
 */

import path from "path";

import {
  loadPolicyV1,
  parseArgs,
  pct,
  readJson,
  resolveRepoPath,
  validateSummaryV1,
  writeJson,
  writeText,
} from "./flaky-io";

import type { EvaluationV1, FlakySummaryV1 } from "./flaky-types";

function buildMd(e: EvaluationV1): string {
  const lines: string[] = [];
  lines.push(`# Flaky Evaluation (v1)`);
  lines.push(``);
  lines.push(`- **Classification:** \`${e.classification}\``);
  lines.push(`- **Action:** \`${e.action}\``);
  lines.push(`- **Fail rate:** **${pct(e.observed.fail_rate)}** (${e.observed.fail_count}/${e.observed.total})`);
  lines.push(`- **Thresholds:** flaky=${pct(e.thresholds.flaky)}, quarantine=${pct(e.thresholds.quarantine)}`);
  lines.push(`- **Block merge:** \`${e.block_merge}\``);
  lines.push(`- **Quarantine enabled:** \`${e.quarantine_enabled}\``);
  lines.push(``);
  lines.push(`## Message`);
  lines.push(e.message);
  lines.push(``);
  lines.push(`## Inputs`);
  lines.push(`- Policy: \`${e.meta.policy}\``);
  lines.push(`- Evidence: \`${e.meta.input}\``);
  lines.push(`- Export path: \`${e.meta.export_path}\``);
  if (e.meta.runner) lines.push(`- Runner: \`${e.meta.runner}\``);
  if (e.meta.command) lines.push(`- Command: \`${e.meta.command}\``);
  lines.push(``);
  lines.push(`## Guidance`);
  if (e.classification === "pass") {
    lines.push(`- No action required.`);
  } else if (e.classification === "informational") {
    lines.push(`- Treat as **informational**. Monitor trends before escalating.`);
  } else if (e.classification === "flaky") {
    lines.push(`- Treat as **flaky**. Stabilize the suite (timing, retries, mocks, network, env).`);
    lines.push(`- Consider tagging (no auto-change in v1): \`@flaky\` and excluding from default runs.`);
  } else {
    lines.push(`- **Quarantine-candidate**. High fail rate observed.`);
    if (!e.quarantine_enabled) {
      lines.push(`- Quarantine is **disabled** in policy; this is advisory only.`);
    } else {
      lines.push(`- Quarantine is enabled: consider marking as \`@flaky\` and excluding from default runs.`);
    }
  }
  lines.push(``);
  return lines.join("\n");
}

function classifyV1(
  failRate: number,
  total: number,
  flakyThreshold: number,
  quarantineThreshold: number,
  quarantineEnabled: boolean
): { classification: EvaluationV1["classification"]; action: EvaluationV1["action"]; message: string } {
  const frPct = pct(failRate);
  const flakyPct = pct(flakyThreshold);
  const quarantinePct = pct(quarantineThreshold);

  if (total <= 0) {
    return {
      classification: "informational",
      action: "warn",
      message: `No attempts recorded (total=0). Cannot compute fail rate. Treating as informational.`,
    };
  }

  if (failRate === 0) {
    return {
      classification: "pass",
      action: "none",
      message: `Suite passed all ${total}/${total} runs.`,
    };
  }

  // 100% failure: likely deterministic regression rather than "flaky"
  if (failRate === 1) {
    const classification: EvaluationV1["classification"] = quarantineEnabled ? "quarantine-candidate" : "flaky";
    const action: EvaluationV1["action"] = quarantineEnabled ? "quarantine-candidate" : "warn";
    return {
      classification,
      action,
      message: `Suite failed ${total}/${total} runs (${frPct}). Likely deterministic failure (not flaky noise).`,
    };
  }

  if (failRate < flakyThreshold) {
    return {
      classification: "informational",
      action: "warn",
      message: `Suite failed ${frPct} of runs. Below flaky threshold (${flakyPct}).`,
    };
  }

  if (failRate >= flakyThreshold && failRate < quarantineThreshold) {
    return {
      classification: "flaky",
      action: "warn",
      message: `Suite failed ${frPct} of runs. >= flaky threshold (${flakyPct}) and < quarantine threshold (${quarantinePct}).`,
    };
  }

  // failRate >= quarantineThreshold
  return {
    classification: "quarantine-candidate",
    action: quarantineEnabled ? "quarantine-candidate" : "warn",
    message: `Suite failed ${frPct} of runs. >= quarantine threshold (${quarantinePct}).`,
  };
}

function main(): void {
  const args = parseArgs(process.argv);

  const policyPath = (args["policy"] as string) || ".governance/flaky-tests.yml";
  const inputPath = (args["input"] as string) || "out/flaky/summary.json";
  const outPath = (args["out"] as string) || "out/flaky/evaluation.json";
  const writeMd = Boolean(args["md"]);

  // Load + validate policy
  const { policy } = loadPolicyV1(policyPath);

  // Load + validate evidence
  const absInput = resolveRepoPath(inputPath);
  const summary = readJson<FlakySummaryV1>(absInput);
  validateSummaryV1(summary);

  const total = summary.total_attempts;
  const fail = summary.fail_count;
  const pass = summary.pass_count;

  const failRate = total > 0 ? fail / total : 0;

  const cls = classifyV1(
    failRate,
    total,
    policy.flaky_threshold,
    policy.quarantine_threshold,
    policy.quarantine_enabled
  );

  // Determine enforcement: must be explicitly enabled in policy
  const enforcementEnabled = policy.enabled === true;
  const blockConfigured = policy.block_merge === true;

  const shouldBlock =
    enforcementEnabled &&
    blockConfigured &&
    (cls.classification === "flaky" || cls.classification === "quarantine-candidate");

  const evaluation: EvaluationV1 = {
    enabled: enforcementEnabled,
    policy_version: "v1",
    scope: policy.scope,

    thresholds: {
      flaky: policy.flaky_threshold,
      quarantine: policy.quarantine_threshold,
    },

    observed: {
      fail_rate: Number(failRate.toFixed(4)),
      fail_count: fail,
      pass_count: pass,
      total,
    },

    classification: cls.classification,
    action: shouldBlock ? "block" : cls.action,

    block_merge: shouldBlock,
    quarantine_enabled: policy.quarantine_enabled,

    message: cls.message + (shouldBlock ? " Merge blocking is ENABLED by policy." : ""),

    meta: {
      input: inputPath,
      policy: policyPath,
      export_path: policy.export_path,
      runner: summary.runner,
      command: summary.command,
    },
  };

  // Write outputs
  const absOut = resolveRepoPath(outPath);
  writeJson(absOut, evaluation);

  if (writeMd) {
    const mdOut = path.join(path.dirname(absOut), "evaluation.md");
    writeText(mdOut, buildMd(evaluation));
  }

  // Always print a deterministic log line
  console.log(`[FLAKY] classification=${evaluation.classification} action=${evaluation.action}`);
  console.log(`[FLAKY] fail_rate=${pct(evaluation.observed.fail_rate)} (${fail}/${total})`);
  console.log(`[FLAKY] thresholds flaky=${pct(evaluation.thresholds.flaky)} quarantine=${pct(evaluation.thresholds.quarantine)}`);
  console.log(`[FLAKY] enabled=${evaluation.enabled} block_merge=${evaluation.block_merge}`);
  console.log(`[FLAKY] ${evaluation.message}`);

  // Exit codes:
  // - Warn-only default: 0
  // - Block only when explicitly enabled & triggered: 2 (distinct from test failures)
  if (evaluation.block_merge) process.exit(2);
}

try {
  main();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);

  // Fail-closed for governance scripts (especially in BrikByte-Studios/.github).
  console.error(`[FLAKY] ERROR: ${msg}`);
  process.exit(1);
}
