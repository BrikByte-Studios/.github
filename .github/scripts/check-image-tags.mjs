#!/usr/bin/env node
/**
 * BrikByteOS Governance — Container Image Tagging Check
 *
 * GOV-IMAGES-TAG-POLICY-CONFIG-001
 *
 * File:
 *   .github/scripts/check-image-tags.mjs
 *
 * Responsibility:
 *   - Validate that CI-built container images are tagged according to the
 *     BrikByteOS image tagging policy:
 *       - At least one SHA-based tag (sha-<short-or-full-hex-sha>)
 *       - At least one SemVer-style tag (vX.Y.Z or X.Y.Z with optional suffix)
 *       - `latest` is allowed only as an additional tag, never alone
 *
 * Inputs:
 *   CLI:
 *     --config <path>
 *       Path to JSON file of the form:
 *         {
 *           "image": "ghcr.io/brikbyte-studios/example-app",
 *           "tags": ["v1.0.0", "sha-0f9b9113", "latest"]
 *         }
 *
 *   Environment (optional overrides):
 *     IMAGE_TAGGING_SEMVER_PATTERN  - override SemVer regex
 *     IMAGE_TAGGING_SHA_PATTERN     - override SHA regex
 *     IMAGE_TAGGING_ALLOW_LATEST    - "true" / "false"
 *
 * Exit codes:
 *   0 = Policy satisfied
 *   1 = Configuration / input error
 *   2 = Tagging policy violation
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Parse CLI args.
 *
 * @param {string[]} argv - Raw process.argv array
 * @returns {{ configPath: string | null }}
 */
function parseArgs(argv) {
  const result = { configPath: null };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") {
      const next = argv[i + 1];
      if (!next) {
        console.error("❌ ERROR: --config requires a file path argument.");
        process.exit(1);
      }
      result.configPath = next;
      i += 1;
    }
  }

  return result;
}

/**
 * Load the image+tags JSON config.
 *
 * @param {string} configPath - Path to JSON file (relative or absolute).
 * @returns {{ image: string; tags: string[] }}
 */
function loadImageTagConfig(configPath) {
  const resolved = path.resolve(configPath);

  if (!fs.existsSync(resolved)) {
    console.error(
      `❌ ERROR: Image tag config file not found at: ${resolved}\n` +
        "   Ensure the Kaniko workflow produced this file before running the check."
    );
    process.exit(1);
  }

  try {
    const raw = fs.readFileSync(resolved, "utf8");
    const parsed = JSON.parse(raw);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.image !== "string" ||
      !Array.isArray(parsed.tags)
    ) {
      console.error(
        `❌ ERROR: Invalid image tag config structure in ${resolved}.\n` +
          "   Expected JSON like:\n" +
          '   {"image": "ghcr.io/org/app", "tags": ["v1.0.0", "sha-abc123"]}'
      );
      process.exit(1);
    }

    return /** @type {{ image: string; tags: string[] }} */ (parsed);
  } catch (err) {
    console.error(`❌ ERROR: Failed to parse JSON from ${resolved}.`);
    console.error(String(err));
    process.exit(1);
  }
}

/**
 * Build the in-memory tagging policy from environment and defaults.
 *
 * In future this can be wired to read the *effective* merged policy
 * from the policy gate engine (PIPE-GOV-8.x).
 *
 * @returns {{
 *   requireSha: boolean;
 *   requireSemver: boolean;
 *   allowLatest: boolean;
 *   allowEnvTags: boolean;
 *   semverRegex: RegExp;
 *   shaRegex: RegExp;
 * }}
 */
function buildPolicy() {
  const semverPattern =
    process.env.IMAGE_TAGGING_SEMVER_PATTERN ||
    "^v?(\\d+)\\.(\\d+)\\.(\\d+)(-[0-9A-Za-z\\.-]+)?$";

  const shaPattern =
    process.env.IMAGE_TAGGING_SHA_PATTERN || "^sha-[0-9a-f]{7,40}$";

  const allowLatestEnv = process.env.IMAGE_TAGGING_ALLOW_LATEST;

  return {
    requireSha: true,
    requireSemver: true,
    allowLatest:
      typeof allowLatestEnv === "string"
        ? allowLatestEnv.toLowerCase() === "true"
        : true,
    allowEnvTags: true,
    semverRegex: new RegExp(semverPattern),
    shaRegex: new RegExp(shaPattern),
  };
}

/**
 * Validate the tags for a single image.
 *
 * @param {{ image: string; tags: string[] }} cfg
 * @param {ReturnType<typeof buildPolicy>} policy
 * @returns {{ ok: boolean; messages: string[] }}
 */
function validateTags(cfg, policy) {
  const { image, tags } = cfg;

  /** @type {string[]} */
  const messages = [];

  if (!tags || tags.length === 0) {
    messages.push("Image tagging policy violation: no tags found for image.");
    return { ok: false, messages };
  }

  const normalizedTags = tags.map((t) => String(t).trim()).filter(Boolean);

  const hasSha = normalizedTags.some((t) => policy.shaRegex.test(t));
  const hasSemver = normalizedTags.some((t) => policy.semverRegex.test(t));
  const hasLatest = normalizedTags.includes("latest");

  // Environment tags (staging, prod, dev, etc.) are allowed as extra context,
  // but we don't enforce their presence here. A future policy rule could.
  // For now they are simply ignored by this validator.

  if (policy.requireSha && !hasSha) {
    messages.push(
      "Image tagging policy violation: missing SHA tag.\n" +
        "  - Expected at least one tag matching pattern: sha-<short-or-full-hex-sha>\n" +
        "  - Example: sha-0f9b9113"
    );
  }

  if (policy.requireSemver && !hasSemver) {
    messages.push(
      "Image tagging policy violation: missing SemVer-style tag.\n" +
        "  - Expected a tag like: vX.Y.Z or X.Y.Z (optionally with pre-release suffix)\n" +
        "  - Example: v1.2.3 or 1.2.3"
    );
  }

  if (hasLatest && normalizedTags.length === 1) {
    messages.push(
      "Image tagging policy violation: `latest` tag is present but no other required tags.\n" +
        "  - `latest` may be used only in addition to SHA + SemVer tags.\n" +
        "  - Required tags:\n" +
        "      * SHA tag (e.g. sha-0f9b9113)\n" +
        "      * SemVer tag (e.g. v1.2.3)"
    );
  }

  const ok = messages.length === 0;

  if (ok) {
    messages.push(
      [
        "✅ Image tagging policy check passed.",
        `  Image: ${image}`,
        `  Tags: ${normalizedTags.join(", ")}`,
      ].join("\n")
    );
  }

  return { ok, messages };
}

/**
 * Main entrypoint.
 */
function main() {
  const { configPath } = parseArgs(process.argv);

  if (!configPath) {
    console.error(
      "❌ ERROR: Missing required argument: --config <path-to-image-tags.json>"
    );
    process.exit(1);
  }

  const cfg = loadImageTagConfig(configPath);
  const policy = buildPolicy();
  const { ok, messages } = validateTags(cfg, policy);

  for (const line of messages) {
    console.log(line);
  }

  if (!ok) {
    // Exit code 2 indicates a *policy violation* (vs 1 = input/config error).
    process.exit(2);
  }
}

main();
