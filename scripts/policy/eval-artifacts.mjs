#!/usr/bin/env node
/**
 * BrikByte Studios — Artifact Integrity Evaluation (PIPE-GOV-7.3.5)
 *
 * Evaluates artifact integrity requirements using:
 *   - policy.artifacts (require_sbom, require_hashes, require_signatures, etc.)
 *   - artifactsInfo from gatherArtifactIntegrity()
 *
 * Writes results into decision.artifacts and returns:
 *   { decision, hasFailures }
 *
 * This evaluation is intentionally conservative:
 *   - If gate is enforced for this branch/env AND any required check is missing
 *     or clearly invalid → result = "fail".
 *   - If gate is not enforced (e.g. non-release branch, non-prod env) → result = "skip".
 *
 * It does NOT (yet) re-hash files for performance reasons; v1 only validates:
 *   - Presence of SBOM file.
 *   - Presence + basic JSON shape of hash manifest.
 *   - Presence + boolean outcome of signature verification status.
 */

import fs from "node:fs";

/**
 * Evaluate artifact integrity according to policy and gathered metadata.
 *
 * @param {object} params
 * @param {object} params.policy        Effective merged policy (org+repo)
 * @param {object} params.artifactsInfo Output of gatherArtifactIntegrity()
 * @param {object} params.decision      Existing decision.json object (mutated in-place)
 * @returns {{ decision: object, hasFailures: boolean }}
 */
export function evaluateArtifacts({ policy, artifactsInfo, decision }) {
  const artifactsPolicy = policy?.artifacts || {};
  const info = artifactsInfo || {};

  // Pre-populate the artifacts section with policy + gathered info.
  const section = {
    enforced: Boolean(info.enforced),
    branch: info.branch || null,
    target_env: info.target_env || null,

    require_sbom: Boolean(artifactsPolicy.require_sbom),
    require_hashes: Boolean(artifactsPolicy.require_hashes),
    require_signatures: Boolean(artifactsPolicy.require_signatures),
    hash_algorithm: artifactsPolicy.hash_algorithm || info.hash_algorithm || null,

    sbom_path: info.sbom_path || artifactsPolicy.sbom_path || null,
    sbom_exists: Boolean(info.sbom_exists),
    sbom_error: info.sbom_error || null,

    hashes_manifest_path:
      info.hashes_manifest_path || artifactsPolicy.hashes_manifest_path || null,
    hashes_manifest_exists: Boolean(info.hashes_manifest_exists),
    hashes_manifest_error: info.hashes_manifest_error || null,
    hashes_manifest_files: info.hashes_manifest
      ? Object.keys(info.hashes_manifest)
      : [],

    signature: {
      tool: artifactsPolicy.signature?.tool || info.signature?.tool || null,
      verify_subject:
        artifactsPolicy.signature?.verify_subject ||
        info.signature?.verify_subject ||
        null,
      status_path:
        info.signature?.status_path ||
        artifactsPolicy.signature?.status_path ||
        null,
      status_exists: Boolean(info.signature?.status_exists),
      status_error: info.signature?.status_error || null,
      signature_verified: info.signature?.signature_verified ?? null,
      failure_reason: info.signature?.failure_reason || null
    },

    // Overall outcome for this gate:
    result: "skip", // pass | fail | skip
    reason: "",
    errors: [] // collect detailed reasons
  };

  // If gate is not enforced for this branch/env, we mark as skip.
  if (!section.enforced) {
    section.result = "skip";
    section.reason =
      "Artifact integrity gate not enforced for this branch/environment (non-release or non-prod).";
  } else {
    // Gate is enforced: perform checks based on policy flags.
    // --- SBOM check ---------------------------------------------------------
    if (section.require_sbom) {
      if (!section.sbom_exists) {
        section.errors.push(
          `SBOM required but not found at path: ${section.sbom_path}`
        );
      }
    }

    // --- Hash manifest check ------------------------------------------------
    if (section.require_hashes) {
      if (!section.hashes_manifest_exists) {
        section.errors.push(
          `Hash manifest required but not found or unreadable at path: ${section.hashes_manifest_path} (${section.hashes_manifest_error || "no additional details"})`
        );
      } else if (section.hashes_manifest_error) {
        section.errors.push(
          `Hash manifest present but invalid: ${section.hashes_manifest_error}`
        );
      } else if (!Array.isArray(section.hashes_manifest_files) || section.hashes_manifest_files.length === 0) {
        section.errors.push(
          "Hash manifest JSON is present but contains no file → hash entries."
        );
      }
      // NOTE v1: We do NOT re-hash files; that could be added later if needed.
    }

    // --- Signature check ----------------------------------------------------
    if (section.require_signatures) {
      const sig = section.signature;

      if (!sig.status_exists) {
        section.errors.push(
          `Signature verification required, but status file not found or unreadable at path: ${sig.status_path} (${sig.status_error || "no additional details"})`
        );
      } else if (sig.signature_verified === false) {
        section.errors.push(
          `Signature verification failed for tool ${sig.tool || "unknown"}: ${
            sig.failure_reason || "no failure reason provided"
          }`
        );
      } else if (sig.signature_verified === null) {
        section.errors.push(
          `Signature verification status is unknown (no boolean flag in status JSON).`
        );
      }

      // Optional: we could validate verify_subject alignment here if
      // the status JSON exposes a subject field. v1 leaves this to the
      // underlying signature job.
    }

    if (section.errors.length === 0) {
      section.result = "pass";
      section.reason =
        "All required artifact integrity checks (SBOM, hashes, signatures) passed for this release.";
    } else {
      section.result = "fail";
      section.reason =
        "Artifact integrity checks failed: " + section.errors.join(" | ");
    }
  }

  const nextDecision = {
    ...(decision || {}),
    artifacts: section
  };

  const hasFailures = section.result === "fail";

  return { decision: nextDecision, hasFailures };
}

/**
 * Utility to load an existing decision.json from disk.
 * Kept here for convenience if this module is used standalone in a gate script.
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
