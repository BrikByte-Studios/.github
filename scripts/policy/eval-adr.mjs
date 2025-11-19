/**
 * BrikByte Studios — ADR Gate Evaluation (PIPE-GOV-7.3.4)
 *
 * This module implements the **ADR & documentation checks** part of the
 * policy gate. It is intentionally pure (no I/O) so it can be unit-tested
 * in isolation.
 *
 * Responsibilities:
 *  - Decide whether an ADR is required, based on changed paths + policy.
 *  - Detect which ADR IDs a PR references (ADR-0001, ADR-0007, etc.).
 *  - Validate that referenced ADRs:
 *      ✓ exist
 *      ✓ pass schema validation (adr-lint.js)
 *      ✓ have status: Accepted (if required)
 *  - Respect waivers for ADR requirements.
 *  - Produce an "adr" block suitable for decision.json.
 */

import { pathMatchesAny, extractAdrIdsFromText } from "./adr-utils.mjs";

/**
 * @typedef {Object} AdrConfig
 * @property {string[]} [required_on_paths]  Glob patterns (e.g., ["infra/**", ".github/**"])
 * @property {boolean} [require_accepted_adr]
 * @property {string}  [adr_file_glob]
 */

/**
 * @typedef {Object} AdrMeta
 * @property {string} id                     ADR ID, e.g. "ADR-0007"
 * @property {string} path                   Relative path, e.g. "docs/adr/007-foo.md"
 * @property {string} status                 Front-matter status: Proposed | Accepted | ...
 * @property {boolean} schemaOk              True if adr-lint.js says "valid"
 * @property {string[]} [schemaErrors]       Human-readable validation issues
 */

/**
 * @typedef {Object} AdrContext
 * @property {string[]} changedFiles         Changed file paths in PR
 * @property {string} prBody                 PR body/description
 * @property {Record<string, AdrMeta>} adrMetaById  Map from "ADR-0007" -> AdrMeta
 * @property {Array<Object>} [waivers]       Waivers array from merged policy (optional)
 */

/**
 * @typedef {Object} AdrDecision
 * @property {boolean} adr_required
 * @property {string[]} triggered_paths
 * @property {string[]} adr_referenced_ids
 * @property {"pass"|"fail"|"fail_waived"|"skipped"} result
 * @property {string} reason
 * @property {Array<AdrMeta>} resolved_adrs
 * @property {Array<string>} schema_issues
 * @property {Array<Object>} waivers_applied
 */

/**
 * Find waivers applicable to this ADR rule.
 *
 * We treat any waiver with rule: "adr.required" or "adr.schema" as relevant.
 *
 * @param {Array<Object>} waivers
 * @returns {Array<Object>}
 */
function filterAdrWaivers(waivers = []) {
  return waivers.filter((w) =>
    w.rule === "adr.required" ||
    w.rule === "adr.schema"
  );
}

/**
 * Evaluate ADR requirements and schema validity based on:
 *  - Policy adr config
 *  - Changed files
 *  - PR body (for ADR references)
 *  - ADR metadata (id, status, schema)
 *  - Waivers (if any)
 *
 * @param {AdrConfig} adrConfig
 * @param {AdrContext} context
 * @returns {AdrDecision}
 */
export function evaluateAdrGate(adrConfig = {}, context = {}) {
  const {
    required_on_paths = [],
    require_accepted_adr = false,
    adr_file_glob = "docs/adr/[0-9][0-9][0-9]-*.md"
  } = adrConfig;

  const {
    changedFiles = [],
    prBody = "",
    adrMetaById = {},
    waivers = []
  } = context;

  const triggered_paths = changedFiles.filter((p) =>
    pathMatchesAny(required_on_paths, p)
  );

  const adr_required = triggered_paths.length > 0;

  // Collect ADR IDs referenced in PR body
  const adr_referenced_ids = extractAdrIdsFromText(prBody);

  const resolved_adrs = adr_referenced_ids
    .map((id) => adrMetaById[id])
    .filter(Boolean);

  const schema_issues = [];
  let hasSchemaFailure = false;
  let hasStatusFailure = false;

  // Evaluate ADR metadata if ADRs were referenced
  if (resolved_adrs.length > 0) {
    for (const meta of resolved_adrs) {
      if (!meta.schemaOk) {
        hasSchemaFailure = true;
        if (meta.schemaErrors && meta.schemaErrors.length) {
          schema_issues.push(
            `ADR ${meta.id} (${meta.path}) schema issues: ${meta.schemaErrors.join(
              "; "
            )}`
          );
        } else {
          schema_issues.push(`ADR ${meta.id} (${meta.path}) failed schema validation.`);
        }
      }

      if (require_accepted_adr && meta.status !== "Accepted") {
        hasStatusFailure = true;
        schema_issues.push(
          `ADR ${meta.id} (${meta.path}) has status "${meta.status}", but "Accepted" is required.`
        );
      }
    }
  }

  const adrWaivers = filterAdrWaivers(waivers);
  const waivers_applied = [];

  /**
   * Helper to decide if we can treat a failure as "fail_waived"
   * instead of hard-failing the gate.
   */
  const hasValidWaiver = adrWaivers.length > 0;

  // ---------------------------
  // Decision logic
  // ---------------------------

  // Case 1: No ADR rules configured at all
  if (!required_on_paths.length) {
    return {
      adr_required: false,
      triggered_paths,
      adr_referenced_ids,
      result: "skipped",
      reason: "No ADR.required_on_paths configured in policy; ADR gate skipped.",
      resolved_adrs,
      schema_issues,
      waivers_applied
    };
  }

  // Case 2: Paths require ADR, but no ADR reference present
  if (adr_required && adr_referenced_ids.length === 0) {
    if (hasValidWaiver) {
      waivers_applied.push(...adrWaivers);
      return {
        adr_required,
        triggered_paths,
        adr_referenced_ids,
        result: "fail_waived",
        reason:
          "ADR required for changes in configured paths but no ADR reference found; treated as waived by policy.",
        resolved_adrs,
        schema_issues,
        waivers_applied
      };
    }

    return {
      adr_required,
      triggered_paths,
      adr_referenced_ids,
      result: "fail",
      reason:
        "ADR required for changes in ADR-governed paths; reference an ADR (e.g. ADR-0007) in the PR description or request a waiver.",
      resolved_adrs,
      schema_issues,
      waivers_applied
    };
  }

  // Case 3: ADR referenced, but we have metadata problems (schema / status)
  if ((hasSchemaFailure || hasStatusFailure) && adr_required) {
    if (hasValidWaiver) {
      waivers_applied.push(...adrWaivers);
      return {
        adr_required,
        triggered_paths,
        adr_referenced_ids,
        result: "fail_waived",
        reason:
          "ADR referenced but failed schema or status requirements; treated as waived by policy.",
        resolved_adrs,
        schema_issues,
        waivers_applied
      };
    }

    return {
      adr_required,
      triggered_paths,
      adr_referenced_ids,
      result: "fail",
      reason:
        "ADR referenced but does not meet governance requirements (schema or status). See schema_issues for details.",
      resolved_adrs,
      schema_issues,
      waivers_applied
    };
  }

  // Case 4: ADR not strictly required (no paths matched) → informational pass
  if (!adr_required) {
    return {
      adr_required,
      triggered_paths,
      adr_referenced_ids,
      result: "pass",
      reason:
        "No ADR-governed paths changed in this PR; ADR checks passed (informational).",
      resolved_adrs,
      schema_issues,
      waivers_applied
    };
  }

  // Case 5: ADR required, ADR referenced, and all validations OK
  return {
    adr_required,
    triggered_paths,
    adr_referenced_ids,
    result: "pass",
    reason:
      "ADR required and valid ADR(s) referenced with acceptable schema and status.",
    resolved_adrs,
    schema_issues,
    waivers_applied
  };
}
