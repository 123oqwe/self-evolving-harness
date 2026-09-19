// L3-engine · package entry.
//
// L3-T01: core types, Sandbox port + STATIC_CORE_PATHS, breaker clause,
// optimizer router, and the `runEvolutionLoop` entry (breaker gate only;
// the generate → score → select → retain → canary body lands in T02–T09).

// Core contract types.
export type {
  SubstrateKind,
  Substrate,
  MutantOrigin,
  Mutant,
  Fitness,
  ParetoPoint,
  ArchiveStatus,
  ArchiveEntry,
  Trajectory,
  OptContext,
  Optimizer,
  Evaluator,
  LoopOptions,
  LoopResult,
} from "./types.js";

// Sandbox port + shared static-core constant.
export type { SecurityEvent, VerifyResult, Sandbox } from "./sandbox.js";
export { STATIC_CORE_PATHS } from "./sandbox.js";

// Breaker clause.
export { BreakerError, NotImplemented, recordSecurityEvent } from "./breaker.js";

// Optimizer router.
export { routeOptimizer } from "./optimizer-router.js";

// ---------------------------------------------------------------------------
// runEvolutionLoop — evolution-loop entry (breaker gate; body lands in T02–T09)
// ---------------------------------------------------------------------------

import type { LoopOptions, LoopResult } from "./types.js";
import type { Sandbox } from "./sandbox.js";
import { STATIC_CORE_PATHS } from "./sandbox.js";
import { BreakerError, recordSecurityEvent } from "./breaker.js";
import { routeOptimizer } from "./optimizer-router.js";

/**
 * L3 evolution-loop entry.
 *
 * MVP (T01) scope: assert the static-core paths are read-only (breaker
 * clause) at entry; if the sandbox signals a writable static-core path, record
 * a security event and reject with `BreakerError`. The full
 * generate → score → select → retain → canary body is delivered by T02–T09;
 * until then a successful breaker gate throws `NotImplemented` for the body so
 * the entry never pretends to evolve.
 *
 * Invariants (§0):
 *  1. strict-improvement hard gate — held-out regression ≥ τ → reject (T04).
 *  2. diversity archive keep-all — never auto-delete (T06).
 *  3. optimizer cannot write static-core — enforced here at entry + per
 *     `sandbox.runVerify` EPERM hit (T01 breaker).
 */
export async function runEvolutionLoop(
  opts: LoopOptions,
): Promise<LoopResult> {
  const sandbox: Sandbox = opts.sandbox;

  // Breaker: assert the canonical static-core set is read-only at entry.
  try {
    await sandbox.assertReadonly(STATIC_CORE_PATHS);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    recordSecurityEvent(sandbox, {
      kind: "static-core-write",
      path: "static-core",
      reason,
    });
    throw new BreakerError(
      `breaker: static-core path writable at loop entry — ${reason}`,
    );
  }

  // Route the optimizer for this substrate kind. Unknown/unsupported kinds
  // throw NotImplemented here (weight → null short-circuits as channel-off).
  const optimizer = routeOptimizer(opts.substrate.kind);
  if (optimizer === null) {
    // Weight channel is off by default; the loop cannot proceed.
    throw new BreakerError(
      `breaker: substrate kind '${opts.substrate.kind}' channel is off`,
    );
  }

  // T01 only owns the entry + breaker. The evolution body (generate/score/
  // select/retain/canary) lands in T02–T09; until then we surface a clear
  // not-implemented signal rather than faking a result.
  throw new BreakerError(
    `breaker: runEvolutionLoop body not implemented (lands in L3-T02..T09); substrate kind='${opts.substrate.kind}'`,
  );
}
