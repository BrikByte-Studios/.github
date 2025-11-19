/**
 * BrikByte Studios — Security Severity Helpers (PIPE-GOV-7.3.3)
 *
 * Provides:
 *  - An ordered severity scale
 *  - Helper to map severities to numeric ranks
 *  - Helper to compute the highest severity from a count map
 */

export const SECURITY_SEVERITIES = ["none", "low", "medium", "high", "critical"];

/**
 * Map severity string to a numeric rank.
 * Lower = less severe; higher = more severe.
 *
 * none(0) < low(1) < medium(2) < high(3) < critical(4)
 *
 * Unknown severities fall back to "medium" as a safe default.
 */
export function severityToRank(severity) {
  if (!severity) return 0;
  const normalized = String(severity).toLowerCase();
  const idx = SECURITY_SEVERITIES.indexOf(normalized);
  return idx === -1 ? SECURITY_SEVERITIES.indexOf("medium") : idx;
}

/**
 * Returns the severity label with the highest rank given a counts object:
 *
 * e.g., counts = { low: 3, high: 1 } -> "high"
 * If all counts are zero or undefined, returns "none".
 */
export function highestSeverityFromCounts(counts = {}) {
  let highest = "none";
  let highestRank = severityToRank("none");

  for (const sev of SECURITY_SEVERITIES) {
    const count = counts[sev] || 0;
    if (count > 0) {
      const rank = severityToRank(sev);
      if (rank > highestRank) {
        highest = sev;
        highestRank = rank;
      }
    }
  }

  return highest;
}

/**
 * True if actual severity is <= allowed severity in terms of risk.
 * i.e. "medium" is stricter than "high", so:
 *
 * isSeverityAllowed("medium", "high") -> true
 * isSeverityAllowed("high", "medium") -> false
 */
export function isSeverityAllowed(maxAllowed, actual) {
  return severityToRank(actual) <= severityToRank(maxAllowed);
}
