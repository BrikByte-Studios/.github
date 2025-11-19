#!/usr/bin/env node
/**
 * BrikByte Studios — Security Gate (PIPE-GOV-7.3.3)
 *
 * CLI used by CI to enforce policy-driven SAST/SCA thresholds.
 *
 * Responsibilities:
 *   - Load effective merged policy (org+repo) from JSON/YAML
 *   - Gather security findings (SAST + SCA reports)
 *   - Evaluate against max_severity thresholds
 *   - Apply waivers (if configured and active)
 *   - Update decision.json with a detailed "security" section
 *   - Exit non-zero if there are unwaived failures
 *
 * Example usage in CI:
 *
 *   node scripts/policy/security-gate.mjs \
 *     --policy out/effective-policy.json \
 *     --decision .audit/decision.json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gatherSecurityFindings } from "./gather.mjs";
import { evaluateSecurity, loadDecision, saveDecision } from "./eval.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Very small argv parser for --key value pairs.
 */
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[name] = true;
    } else {
      args[name] = next;
      i++;
    }
  }
  return args;
}

function readPolicy(policyPath) {
  if (!fs.existsSync(policyPath)) {
    throw new Error(`Effective policy JSON not found at ${policyPath}`);
  }
  const raw = fs.readFileSync(policyPath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Unable to parse effective policy JSON at ${policyPath}: ${err.message}`);
  }
}

async function main() {
  try {
    const args = parseArgs(process.argv);

    const policyPath =
      args.policy || path.resolve(process.cwd(), "out/effective-policy.json");
    const decisionPath =
      args.decision || path.resolve(process.cwd(), ".audit/decision.json");

    const workspaceRoot = process.cwd();

    const policy = readPolicy(policyPath);
    const securityFindings = gatherSecurityFindings(policy, workspaceRoot);

    const existingDecision = loadDecision(decisionPath);
    const { decision, hasUnwaivedFailures } = evaluateSecurity({
      policy,
      securityFindings,
      decision: existingDecision
    });

    // Ensure .audit directory exists
    const auditDir = path.dirname(decisionPath);
    if (!fs.existsSync(auditDir)) {
      fs.mkdirSync(auditDir, { recursive: true });
    }

    saveDecision(decisionPath, decision);

    if (hasUnwaivedFailures) {
      console.error(
        "❌ Security gate failed: unwaived SAST/SCA findings exceed configured max_severity. See decision.json.security for details."
      );
      process.exit(1);
    }

    console.log("✅ Security gate passed: SAST/SCA severities within allowed thresholds (or covered by waivers).");
  } catch (err) {
    console.error(`::error file=scripts/policy/security-gate.mjs::${err.message}`);
    process.exit(1);
  }
}

main();
