/**
 * =============================================================================
 * BrikByteOS — Flaky Types (v1)
 * -----------------------------------------------------------------------------
 * Purpose:
 *   Centralize all TypeScript types/interfaces for flaky policy + evidence +
 *   evaluation outputs so scripts remain consistent across repos/workflows.
 *
 * Scope:
 *   v1 = suite-level classification only (no per-test IDs yet).
 * =============================================================================
 */

export type FlakyScopeV1 = "suite" | "test";
export type ClassificationV1 =
  | "pass"
  | "informational"
  | "flaky"
  | "quarantine-candidate";

export type ActionV1 = "none" | "warn" | "block" | "quarantine-candidate";

export interface FlakyPolicyV1 {
  /** Must be "v1" for this evaluator. */
  policy_version: "v1";

  /**
   * If false, evaluation may still run if CI calls it,
   * but enforcement MUST remain warn-only.
   */
  enabled: boolean;

  /**
   * Expected number of repeat-run attempts.
   * Used for validation guidance (not strict gating unless you choose).
   */
  reruns: number;

  /** 0..1 (fraction). Example: 0.5 = 50%. */
  flaky_threshold: number;

  /** 0..1 (fraction). Must be >= flaky_threshold. */
  quarantine_threshold: number;

  /**
   * If true, evaluator can recommend quarantine-candidate outcomes.
   * v1 does not auto-edit tests; it only emits guidance.
   */
  quarantine_enabled: boolean;

  /**
   * If true AND enabled=true AND classification is flaky/quarantine-candidate
   * then evaluator exits non-zero to block merge.
   */
  block_merge: boolean;

  /**
   * v1 supports "suite" only to avoid per-test complexity.
   * v2 may implement "test" when evidence includes stable test IDs.
   */
  scope: FlakyScopeV1;

  /**
   * Output folder for evaluation artifacts.
   * Relative to repo root unless absolute.
   */
  export_path: string;
}

export interface PolicyFileV1 {
  flaky: FlakyPolicyV1;
}

export interface AttemptV1 {
  /** 1-based attempt number (1..N). */
  attempt: number;

  /** Process exit code for that attempt (0 = pass, non-zero = fail). */
  exit_code: number;

  /** Optional duration in milliseconds. */
  duration_ms?: number;
}

/**
 * Repeat-run evidence contract (v1).
 * Produced by the flaky rerun wrapper from PIPE-FLAKY-RERUN-INTEG-001.
 */
export interface FlakySummaryV1 {
  /** Command that was executed (informational). */
  command?: string;

  /** Runner/framework identifier (optional but helpful). */
  runner?: string;

  /** Attempt-level results. */
  attempts: AttemptV1[];

  /** Count of failed attempts. */
  fail_count: number;

  /** Count of passed attempts. */
  pass_count: number;

  /** Total attempts = fail_count + pass_count. */
  total_attempts: number;

  /** Optional timestamps for audit. */
  started_at?: string;
  finished_at?: string;
}

/**
 * Evaluator output contract (v1).
 */
export interface EvaluationV1 {
  /** Whether policy enabled enforcement logic (still warn-only unless block_merge is true). */
  enabled: boolean;

  policy_version: "v1";
  scope: FlakyScopeV1;

  thresholds: {
    flaky: number;
    quarantine: number;
  };

  observed: {
    fail_rate: number;
    fail_count: number;
    pass_count: number;
    total: number;
  };

  classification: ClassificationV1;
  action: ActionV1;

  /** Effective merge blocking decision (enabled && block_merge && classification triggers). */
  block_merge: boolean;

  quarantine_enabled: boolean;

  message: string;

  meta: {
    input: string;
    policy: string;
    export_path: string;
    runner?: string;
    command?: string;
  };
}
