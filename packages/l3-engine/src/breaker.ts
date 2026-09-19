// L3-engine · runtime breaker clause.
//
// Spec: execution/L3-engine/TASKS.md §L3-T01 (breaker) + §0 invariant 3
// (优化器不可改 static-core). Any `attemptWrite(static-core-paths)` must
// `reject + securityEvent(session log)`. The breaker is the L3-side
// enforcement of L0C-T10/L0C-T11 read-only invariants at the evolution-loop
// entry and on every sandbox.runVerify that reports EPERM hits.
//
// Design basis (not imported): @specpow/framework/execution-verification-before-
// completion "no fresh evidence → no done claim"铁律 — here: no successful
// readonly assertion → no loop entry.

// ---------------------------------------------------------------------------
// Error classes (named exports so tests can assert `toThrow(BreakerError)`)
// ---------------------------------------------------------------------------

/**
 * Raised when the breaker detects a static-core write attempt (either an
 * `assertReadonly` failure at loop entry or an EPERM hit from `runVerify`).
 * The accompanying message always contains `breaker` + `static-core` so the
 * integration scenario's `/breaker.*static-core/i` matcher holds.
 */
export class BreakerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BreakerError";
  }
}

/**
 * Raised for substrate kinds whose optimizer is a V2 placeholder
 * (e.g. `workflow` → AFlow, `skill` → evolve-skill-adapter). MVP does not
 * wire these channels; calling them throws so the route table cannot silently
 * fall through.
 */
export class NotImplemented extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotImplemented";
  }
}

// ---------------------------------------------------------------------------
// Breaker helpers
// ---------------------------------------------------------------------------

import type { Sandbox, SecurityEvent } from "./sandbox.js";

/**
 * Records a security event into `sandbox.log.securityEvents` describing a
 * static-core write attempt. The breaker calls this before throwing
 * `BreakerError` so the event is observable even when the call is rejected.
 */
export function recordSecurityEvent(
  sandbox: Sandbox,
  event: Omit<SecurityEvent, "ts">,
): void {
  const entry: SecurityEvent = { ...event, ts: Date.now() };
  sandbox.log.securityEvents.push(entry);
}
