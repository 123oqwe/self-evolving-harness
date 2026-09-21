// L3-engine · weight channel gate [V2].
//
// Spec: execution/L3-engine/TASKS.md §L3-T15 (权重通道 spec, 默认 off) +
// specs/L3-T15-weight-channel-spec.md (the pinned threshold oracle).
//
// This module DOES NOT implement weight training (RLVR/Self-Rewarding/RLEF/
// DPPO/WebRL). It only provides the *invariant test hook* that enforces the
// default-off invariant (PRD §6.1 N1 / R6) and the four-threshold gate that
// any future off→on flip must satisfy. Weight-training implementation is
// deferred to a separate project pending spec review.
//
// Four thresholds (spec-pinned; this module mirrors the spec values):
//   1. KL_MAX                       = 0.05   (WebRL KL anchor to anchor policy)
//   2. ORACLE_PASS_MIN              = 0.9    (independent external oracle, NOT
//                                            self-judge / evolution substrate)
//   3. CONSOLIDATION_NONINFERIOR    = true   (SFT consolidation [DPPO] held-out
//                                            non-inferior to RL policy)
//   4. HUMAN_GATE_SIGNED            = true   (human signature; breaker rejects
//                                            any runtime off→on without it)

import { BreakerError, recordSecurityEvent } from "./breaker.js";
import type { Sandbox } from "./sandbox.js";

// ---------------------------------------------------------------------------
// Default-off invariant (PRD §6.1 N1). Frozen const; no setter is exposed.
// ---------------------------------------------------------------------------

export const WEIGHT_CHANNEL_DEFAULT = "off" as const;

// ---------------------------------------------------------------------------
// Spec-pinned threshold constants (single source of truth = the spec doc;
// this module mirrors them for the invariant test oracle).
// ---------------------------------------------------------------------------

export const KL_MAX = 0.05;
export const ORACLE_PASS_MIN = 0.9;
export const CONSOLIDATION_NONINFERIOR_REQUIRED = true;
export const HUMAN_GATE_SIGNED_REQUIRED = true;

// ---------------------------------------------------------------------------
// Precondition payload + gate result
// ---------------------------------------------------------------------------

export interface WeightChannelPreconditions {
  /** Post-training KL divergence vs the anchor policy (WebRL). */
  klDivergence: number;
  /** Held-out pass rate of an INDEPENDENT external oracle (not self-judge). */
  oraclePassRate: number;
  /** SFT consolidation (DPPO) held-out non-inferior to RL policy. */
  consolidationNonInferior: boolean;
  /** Human gate signature authorizing the off→on flip. */
  humanSigned: boolean;
}

export interface WeightChannelGateResult {
  /** true only when ALL four preconditions are satisfied. */
  open: boolean;
  /** Empty iff open=true; otherwise one human-readable reason per failed gate. */
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Gate options
// ---------------------------------------------------------------------------

export interface WeightChannelGateOptions {
  /**
   * Sandbox used to record security events when `attemptOpen` is rejected by
   * the breaker. Required for the runtime off→on breaker path; `checkOpen`
   * is a pure function and does not touch the sandbox.
   */
  sandbox?: Sandbox;
}

// ---------------------------------------------------------------------------
// WeightChannelGate
// ---------------------------------------------------------------------------

/**
 * Four-threshold gate for the weight channel. `checkOpen` is a pure function
 * over the four preconditions; `attemptOpen` additionally enforces the
 * runtime breaker (any off→on without a human signature is rejected with a
 * `BreakerError` + a recorded security event — defence against reward
 * tampering, inheriting L3-T01's route-table freeze + L3-T08 rollback).
 *
 * open=true ⟺ ALL of:
 *   - klDivergence            ≤ KL_MAX          (0.05)
 *   - oraclePassRate          ≥ ORACLE_PASS_MIN (0.9)
 *   - consolidationNonInferior === true
 *   - humanSigned             === true
 */
export class WeightChannelGate {
  private readonly sandbox: Sandbox | undefined;

  constructor(opts: WeightChannelGateOptions = {}) {
    this.sandbox = opts.sandbox;
  }

  /**
   * Pure four-threshold check. Does NOT touch the sandbox and does NOT flip
   * the channel — it only reports whether the preconditions are satisfied.
   */
  checkOpen(pre: WeightChannelPreconditions): WeightChannelGateResult {
    const reasons: string[] = [];

    if (pre.klDivergence > KL_MAX) {
      reasons.push(
        `KL anchor violated: klDivergence=${pre.klDivergence} > KL_MAX=${KL_MAX} (WebRL abort, no consolidation)`,
      );
    }
    if (pre.oraclePassRate < ORACLE_PASS_MIN) {
      reasons.push(
        `external oracle unavailable or below threshold: oraclePassRate=${pre.oraclePassRate} < ORACLE_PASS_MIN=${ORACLE_PASS_MIN} (independent oracle, not self-judge)`,
      );
    }
    if (pre.consolidationNonInferior !== CONSOLIDATION_NONINFERIOR_REQUIRED) {
      reasons.push(
        `SFT consolidation (DPPO) not non-inferior on held-out: consolidationNonInferior=${pre.consolidationNonInferior} (consolidation required before deploy)`,
      );
    }
    if (pre.humanSigned !== HUMAN_GATE_SIGNED_REQUIRED) {
      reasons.push(
        `human gate not signed: humanSigned=${pre.humanSigned} (runtime off→on requires human authorization)`,
      );
    }

    return { open: reasons.length === 0, reasons };
  }

  /**
   * Runtime off→on attempt. Runs `checkOpen`; if any precondition is
   * unsatisfied the breaker rejects the flip with a `BreakerError` and
   * records a security event (reward-tampering / unsanctioned-enable defence,
   * inheriting L3-T01 route-table freeze + L3-T08 rollback threshold freeze).
   *
   * The channel remains `off` after any rejected attempt
   * (`WEIGHT_CHANNEL_DEFAULT === 'off'` is immutable).
   */
  attemptOpen(pre: WeightChannelPreconditions): WeightChannelGateResult {
    const result = this.checkOpen(pre);
    if (!result.open) {
      const reason = `breaker: weight channel off→on rejected — ${result.reasons.join("; ")}`;
      const sandbox = this.sandbox;
      if (sandbox) {
        recordSecurityEvent(sandbox, {
          kind: "weight-channel-breaker",
          path: "l3-engine/optimizer-router/weight",
          reason,
        });
      }
      throw new BreakerError(reason);
    }
    // Even when all four preconditions pass, this hook does NOT flip the
    // immutable default; an actual enable is a separate, reviewed, deployed
    // change (spec §回滚预案). The breaker-accepted result is returned for
    // audit logging.
    return result;
  }
}

Object.freeze(WeightChannelGate.prototype);
