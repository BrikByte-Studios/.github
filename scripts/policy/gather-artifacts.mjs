#!/usr/bin/env node
/**
 * BrikByte Studios — Artifact Integrity Gatherer (PIPE-GOV-7.3.5)
 *
 * Responsibility:
 *   - Read the effective policy (policy.artifacts).
 *   - Decide whether artifact integrity checks are ENFORCED for this run
 *     (e.g. only for release/* branches and target_env=prod).
 *   - Inspect workspace for:
 *       - SBOM file (exists? path?)
 *       - Hash manifest (exists? JSON parse OK? entries?)
 *       - Signature verification result (from a JSON status file or similar).
 *   - Return a normalized object consumed by the evaluation logic.
 *
 * This module is designed to be imported by:
 *   - scripts/policy/gather.mjs (central gather step), or
 *   - a dedicated gate script (e.g. artifacts-gate.js).
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Utility: safe JSON read. Returns { ok, value, error }.
 *
 * @param {string} filePath
 * @returns {{ok: boolean, value: any|null, error: string|null}}
 */
function safeReadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return { ok: false, value: null, error: `File not found: ${filePath}` };
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const value = JSON.parse(raw);
    return { ok: true, value, error: null };
  } catch (err) {
    return {
      ok: false,
      value: null,
      error: `Unable to parse JSON at ${filePath}: ${err.message}`
    };
  }
}

/**
 * Determine whether artifact integrity checks should be enforced
 * for this run, based on branch and environment.
 *
 * Convention:
 *   - Enforce only when:
 *       - targetEnv === "prod" (case-sensitive), AND
 *       - branch is under "release/*" (either GITHUB_REF style or short name).
 *
 * @param {string | undefined} branch
 * @param {string | undefined} targetEnv
 * @returns {boolean}
 */
export function isArtifactGateEnforced(branch, targetEnv) {
  if (!branch || !targetEnv) return false;

  const env = String(targetEnv).toLowerCase();
  if (env !== "prod") return false;

  // Accept both "refs/heads/release/..." and "release/..." forms.
  const shortRef = branch.startsWith("refs/heads/")
    ? branch.replace("refs/heads/", "")
    : branch;

  return shortRef.startsWith("release/");
}

/**
 * Gather artifact integrity metadata from the workspace according
 * to the effective policy.
 *
 * @param {object} params
 * @param {object} params.policy         Effective merged policy (org+repo)
 * @param {string} params.workspaceRoot  CI workspace root (e.g. process.cwd())
 * @param {object} params.env            Environment variables (e.g. process.env)
 * @returns {object} artifactsInfo
 *
 * artifactsInfo shape:
 *   {
 *     enforced: boolean,
 *     branch: string | null,
 *     target_env: string | null,
 *     require_sbom: boolean,
 *     require_hashes: boolean,
 *     require_signatures: boolean,
 *     hash_algorithm: string | null,
 *     sbom_path: string | null,
 *     sbom_exists: boolean,
 *     sbom_error: string | null,
 *     hashes_manifest_path: string | null,
 *     hashes_manifest_exists: boolean,
 *     hashes_manifest_error: string | null,
 *     hashes_manifest: object | null,
 *     signature: {
 *       tool: string | null,
 *       verify_subject: string | null,
 *       status_path: string | null,
 *       status_exists: boolean,
 *       status_error: string | null,
 *       signature_verified: boolean | null,
 *       failure_reason: string | null,
 *       raw: any | null
 *     }
 *   }
 */
export function gatherArtifactIntegrity({ policy, workspaceRoot, env }) {
  const artifactsPolicy = policy?.artifacts || {};

  const branch =
    env.GITHUB_REF ||
    env.BRANCH_NAME ||
    env.CI_COMMIT_REF_NAME ||
    null;

  const targetEnv =
    env.TARGET_ENV ||
    env.DEPLOY_ENV ||
    env.ENVIRONMENT ||
    null;

  const enforced = isArtifactGateEnforced(branch, targetEnv);

  // Base shape with defaults; evaluators can use this even if enforced === false
  const info = {
    enforced,
    branch,
    target_env: targetEnv,
    require_sbom: Boolean(artifactsPolicy.require_sbom),
    require_hashes: Boolean(artifactsPolicy.require_hashes),
    require_signatures: Boolean(artifactsPolicy.require_signatures),
    hash_algorithm: artifactsPolicy.hash_algorithm || null,

    sbom_path: artifactsPolicy.sbom_path || "artifacts/sbom.spdx.json",
    sbom_exists: false,
    sbom_error: null,

    hashes_manifest_path:
      artifactsPolicy.hashes_manifest_path || "artifacts/manifest.json",
    hashes_manifest_exists: false,
    hashes_manifest_error: null,
    hashes_manifest: null,

    signature: {
      tool: artifactsPolicy.signature?.tool || null,
      verify_subject: artifactsPolicy.signature?.verify_subject || null,
      status_path:
        artifactsPolicy.signature?.status_path ||
        "artifacts/signature-status.json",
      status_exists: false,
      status_error: null,
      signature_verified: null,
      failure_reason: null,
      raw: null
    }
  };

  // If gate is not enforced for this branch/env, we still return the shape
  // but do not bother checking file system. Eval layer will mark result as "skip".
  if (!enforced) {
    return info;
  }

  const sbomAbsPath = path.resolve(workspaceRoot, info.sbom_path);
  const manifestAbsPath = path.resolve(
    workspaceRoot,
    info.hashes_manifest_path
  );
  const sigStatusAbsPath = path.resolve(
    workspaceRoot,
    info.signature.status_path
  );

  // --- SBOM presence check ---------------------------------------------------
  if (fs.existsSync(sbomAbsPath)) {
    info.sbom_exists = true;
  } else {
    info.sbom_exists = false;
    info.sbom_error = `SBOM file not found at ${info.sbom_path}`;
  }

  // --- Hash manifest presence + basic JSON structure ------------------------
  const manifestResult = safeReadJson(manifestAbsPath);
  if (manifestResult.ok) {
    info.hashes_manifest_exists = true;
    if (
      manifestResult.value &&
      typeof manifestResult.value === "object" &&
      !Array.isArray(manifestResult.value)
    ) {
      info.hashes_manifest = manifestResult.value;
    } else {
      info.hashes_manifest_error =
        "Hash manifest is not a JSON object mapping file → hash.";
    }
  } else {
    info.hashes_manifest_exists = false;
    info.hashes_manifest_error = manifestResult.error;
  }

  // --- Signature verification status ----------------------------------------
  const sigResult = safeReadJson(sigStatusAbsPath);
  if (sigResult.ok) {
    info.signature.status_exists = true;
    info.signature.raw = sigResult.value;

    // We try to normalize a few common shapes. v1 is intentionally simple.
    const v = sigResult.value;
    if (typeof v.signature_verified === "boolean") {
      info.signature.signature_verified = v.signature_verified;
      info.signature.failure_reason = v.failure_reason || null;
    } else if (typeof v.verified === "boolean") {
      info.signature.signature_verified = v.verified;
      info.signature.failure_reason = v.reason || null;
    } else {
      // Unknown structure: treat as unknown result, let evaluator handle it.
      info.signature.signature_verified = null;
      info.signature.failure_reason =
        v.failure_reason ||
        v.reason ||
        "Signature status JSON did not contain a recognized verification flag.";
    }
  } else {
    info.signature.status_exists = false;
    info.signature.status_error = sigResult.error;
    info.signature.signature_verified = null;
    info.signature.failure_reason = sigResult.error;
  }

  return info;
}
