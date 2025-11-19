// scripts/policy/adr-utils.mjs

/**
 * BrikByte Studios — ADR Utilities (PIPE-GOV-7.3.4)
 *
 * Small helper functions for:
 *  - Matching changed paths against ADR-required globs
 *  - Parsing ADR identifiers (ADR-0001, ADR-0123, etc.) from text
 *
 * These are intentionally pure and dependency-free to make unit testing easy.
 */

/**
 * Very small glob → RegExp translator for the patterns we care about:
 *
 * Supported:
 *   - "infra/**"       -> prefix match
 *   - ".github/**"     -> prefix match
 *   - "security/**"    -> prefix match
 *   - Exact paths: "infra/cluster.tf"
 *   - Simple "*" segments (e.g. "charts/*
 * /values.yaml")
 *
 * NOT a full glob engine, but sufficient for governance patterns.
 *
 * @param {string} pattern - Glob-like pattern.
 * @returns {RegExp} A regular expression that approximates the pattern.
 */
export function globToRegExp(pattern) {
  // Special case: patterns ending in "/**" → prefix match
  if (pattern.endsWith("/**")) {
    const base = pattern.slice(0, -3); // remove "/**"
    const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escaped}(/.*)?$`);
  }

  // Escape regex special chars, then replace globs
  let regexStr = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

  // Replace "**" (any depth) then "*" (single segment)
  regexStr = regexStr
    .replace(/\*{2}/g, ".*")
    .replace(/\*/g, "[^/]*");

  return new RegExp(`^${regexStr}$`);
}

/**
 * Returns true if any pattern matches the given path.
 *
 * @param {string[]} patterns - Glob-like patterns.
 * @param {string} filePath  - Repository-relative file path.
 * @returns {boolean}
 */
export function pathMatchesAny(patterns = [], filePath = "") {
  if (!patterns.length || !filePath) return false;
  return patterns.some((p) => globToRegExp(p).test(filePath));
}

/**
 * Extract ADR IDs from a text blob (e.g., PR title/body).
 *
 * Matches tokens like:
 *   - ADR-0001
 *   - ADR-0123
 *
 * @param {string} text
 * @returns {string[]} Unique ADR IDs found, e.g. ["ADR-0001", "ADR-0007"]
 */
export function extractAdrIdsFromText(text = "") {
  const regex = /ADR-\d{4}/g;
  const found = text.match(regex) || [];
  // Deduplicate while preserving order
  const seen = new Set();
  const result = [];
  for (const id of found) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}
