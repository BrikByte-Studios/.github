/**
 * =============================================================================
 * BrikByteOS — Flaky IO Helpers (v1)
 * -----------------------------------------------------------------------------
 * Purpose:
 *   Reusable IO + validation utilities for flaky scripts.
 *
 * Provides:
 *   - readJson / writeJson / writeText
 *   - safe path resolution + mkdir
 *   - policy/summary validation helpers
 *   - deterministic formatting helpers
 *
 * Notes:
 *   - Keep helpers small and dependency-light.
 * =============================================================================
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";

import type { FlakyPolicyV1, FlakySummaryV1, PolicyFileV1 } from "./flaky-types";

/** Read JSON file and parse into type T. Throws on invalid JSON. */
export function readJson<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as T;
}

/** Write JSON to disk with deterministic formatting and trailing newline. */
export function writeJson(filePath: string, obj: unknown): void {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

/** Write text file to disk. */
export function writeText(filePath: string, content: string): void {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

/** Ensure directory exists. */
export function mkdirp(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

/** Resolve a path relative to repo root (process.cwd()) unless already absolute. */
export function resolveRepoPath(p: string): string {
  if (path.isAbsolute(p)) return p;
  return path.resolve(process.cwd(), p);
}

/** Strict type checks with clear error messages. */
export function mustBeNumber(name: string, v: unknown): number {
  if (typeof v !== "number" || Number.isNaN(v)) {
    throw new Error(`Invalid value: ${name} must be a number`);
  }
  return v;
}

export function mustBeBool(name: string, v: unknown): boolean {
  if (typeof v !== "boolean") {
    throw new Error(`Invalid value: ${name} must be a boolean`);
  }
  return v;
}

export function mustBeString(name: string, v: unknown): string {
  if (typeof v !== "string" || v.trim() === "") {
    throw new Error(`Invalid value: ${name} must be a non-empty string`);
  }
  return v;
}

/** Clamp number to [0, 1]. */
export function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/** Format fraction 0..1 as percent integer string, e.g. 0.33 => "33%". */
export function pct(x: number): string {
  return `${Math.round(clamp01(x) * 100)}%`;
}

/**
 * Parse and normalize policy YAML into FlakyPolicyV1.
 * Throws if missing required keys or unsupported scope/version.
 */
export function loadPolicyV1(policyPath: string): { file: PolicyFileV1; policy: FlakyPolicyV1 } {
  const abs = resolveRepoPath(policyPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Policy file not found: ${policyPath}`);
  }

  const raw = fs.readFileSync(abs, "utf8");
  const parsed = yaml.load(raw) as PolicyFileV1;

  if (!parsed || typeof parsed !== "object" || !(parsed as any).flaky) {
    throw new Error(`Invalid policy YAML: missing top-level "flaky" key`);
  }

  const f = (parsed as any).flaky;

  const policy: FlakyPolicyV1 = {
    policy_version: "v1",
    enabled: mustBeBool("flaky.enabled", f.enabled),
    reruns: mustBeNumber("flaky.reruns", f.reruns),
    flaky_threshold: mustBeNumber("flaky.flaky_threshold", f.flaky_threshold),
    quarantine_threshold: mustBeNumber("flaky.quarantine_threshold", f.quarantine_threshold),
    quarantine_enabled: mustBeBool("flaky.quarantine_enabled", f.quarantine_enabled),
    block_merge: mustBeBool("flaky.block_merge", f.block_merge),
    scope: mustBeString("flaky.scope", f.scope) as FlakyPolicyV1["scope"],
    export_path: mustBeString("flaky.export_path", f.export_path),
  };

  validatePolicyV1(policy);

  return { file: parsed, policy };
}

/**
 * Validate policy constraints for v1.
 * - thresholds in [0,1]
 * - quarantine_threshold >= flaky_threshold
 * - scope must be "suite" in v1
 */
export function validatePolicyV1(p: FlakyPolicyV1): void {
  if (p.policy_version !== "v1") {
    throw new Error(`Unsupported policy_version: ${p.policy_version}`);
  }

  if (p.reruns < 1) {
    throw new Error(`Invalid policy: reruns must be >= 1`);
  }

  if (p.flaky_threshold < 0 || p.flaky_threshold > 1) {
    throw new Error(`Invalid policy: flaky_threshold must be between 0 and 1`);
  }

  if (p.quarantine_threshold < 0 || p.quarantine_threshold > 1) {
    throw new Error(`Invalid policy: quarantine_threshold must be between 0 and 1`);
  }

  if (p.quarantine_threshold < p.flaky_threshold) {
    throw new Error(`Invalid policy: quarantine_threshold must be >= flaky_threshold`);
  }

  // v1 guardrail
  if (p.scope !== "suite") {
    throw new Error(`Unsupported scope in v1: ${p.scope}. Use scope: "suite".`);
  }
}

/**
 * Validate flaky summary evidence input.
 * Recommended: fail-closed for governance scripts.
 */
export function validateSummaryV1(s: FlakySummaryV1): void {
  if (!Array.isArray(s.attempts) || s.attempts.length < 1) {
    throw new Error(`Invalid summary: attempts[] missing or empty`);
  }

  if (typeof s.fail_count !== "number" || typeof s.pass_count !== "number" || typeof s.total_attempts !== "number") {
    throw new Error(`Invalid summary: fail_count/pass_count/total_attempts must be numbers`);
  }

  if (s.total_attempts !== s.fail_count + s.pass_count) {
    throw new Error(`Invalid summary: total_attempts must equal fail_count + pass_count`);
  }

  // Optional: ensure attempt numbering is sane (1..N)
  for (const a of s.attempts) {
    if (typeof a.attempt !== "number" || a.attempt < 1) {
      throw new Error(`Invalid summary: attempt.attempt must be >= 1`);
    }
    if (typeof a.exit_code !== "number") {
      throw new Error(`Invalid summary: attempt.exit_code must be a number`);
    }
  }
}

/**
 * A small, deterministic CLI args parser:
 *  --key value
 *  --flag (boolean)
 */
export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];

    if (t === "--md") {
      args["md"] = true;
      continue;
    }

    if (t.startsWith("--")) {
      const key = t.slice(2);
      const val = argv[i + 1];
      if (!val || val.startsWith("--")) {
        throw new Error(`Missing value for --${key}`);
      }
      args[key] = val;
      i++;
    }
  }
  return args;
}
