// L3-T08: Canary shadow + auto-revert trigger (rollback mechanism body) [MVP]
//
// Spec: execution/L3-engine/TASKS.md §L3-T08.
//
// Static-core invariant: `rollbackThreshold` is frozen — the optimizer path
// cannot mutate it (breaker clause: reward tampering). Any setter attempt
// raises `BreakerError` and records a `securityEvent` in the sandbox session
// log.
//
// The actual `git checkout <toSha>` execution body is NOT here. It is owned
// exclusively by CE-T06 `src/revert.ts` (static-core). L3-T08 only:
//   - freezes `rollbackThreshold`,
//   - publishes a 5% canary shadow (`publishShadow`),
//   - detects regression signals and, when a threshold is breached, calls the
//     injected `revertExec(toSha)` which delegates to CE-T06's rollback body.
//
// PII leak is zero-tolerance: any `pii_leak` signal reverts immediately,
// regardless of severity or threshold.

import type { Fitness, Mutant } from "../types.js";
import type { Sandbox } from "../sandbox.js";
import { BreakerError, recordSecurityEvent } from "../breaker.js";

/**
 * Regression signal raised by the canary observation pipeline. `severity` is
 * the magnitude of the regression (e.g. resolve_rate drop in pp, cost spike
 * ratio, PII count). `pii_leak` is zero-tolerance.
 */
export interface RegressionSignal {
  kind: "resolve_drop" | "cost_spike" | "pii_leak" | "pareto_dominated";
  severity: number;
}

/**
 * Result of `onRegressionSignal`.
 */
export interface RevertResult {
  reverted: boolean;
  toSha: string;
}

/**
 * Handle returned by `publishShadow` — identifies the active canary shadow
 * so the caller can correlate subsequent regression signals with the shadow
 * under test.
 */
export interface CanaryHandle {
  mutantId: string;
  ratio: number;
  baselineSha: string;
}

export interface AutoRevertOptions {
  sandbox: Sandbox;
  rollbackThreshold: Partial<Record<keyof Fitness, number>>;
  revertExec: (toSha: string) => Promise<void>;
  /**
   * Optional baseline sha to revert to. Defaults to a sentinel; in the full
   * closed loop this is the parent substrate sha of the published shadow.
   */
  baselineSha?: string;
}

/**
 * Maps a regression kind to the Fitness objective whose threshold governs it.
 * `pii_leak` is handled separately (zero-tolerance).
 */
function thresholdKeyFor(
  kind: RegressionSignal["kind"],
): keyof Fitness | null {
  switch (kind) {
    case "resolve_drop":
      return "resolve_rate";
    case "cost_spike":
      return "token";
    case "pareto_dominated":
      return "cache_hit";
    default:
      return null; // pii_leak — zero tolerance, no threshold lookup
  }
}

/**
 * Canary shadow publisher + auto-revert trigger.
 *
 * The `rollbackThreshold` field is exposed as a Proxy whose set trap enforces
 * the static-core freeze: any mutation attempt raises `BreakerError` and
 * records a security event (reward-tampering defence).
 */
export class AutoRevert {
  private readonly _sandbox: Sandbox;
  private readonly _revertExec: (toSha: string) => Promise<void>;
  private readonly _baselineSha: string;
  private _shadow: CanaryHandle | null = null;

  /**
   * Frozen rollback threshold (static-core). Exposed for read access by the
   * optimizer; any write attempt is rejected by the breaker.
   */
  public readonly rollbackThreshold: Partial<Record<keyof Fitness, number>>;

  constructor(opts: AutoRevertOptions) {
    this._sandbox = opts.sandbox;
    this._revertExec = opts.revertExec;
    this._baselineSha = opts.baselineSha ?? "sha-baseline";

    const frozen: Partial<Record<keyof Fitness, number>> = { ...opts.rollbackThreshold };
    Object.freeze(frozen);

    const self = this;
    this.rollbackThreshold = new Proxy(frozen, {
      set(_t, prop, _value) {
        recordSecurityEvent(self._sandbox, {
          kind: "breaker",
          path: `rollbackThreshold.${String(prop)}`,
          reason: "rollbackThreshold is static-core (frozen); optimizer cannot mutate",
        });
        throw new BreakerError(
          `breaker: rollbackThreshold.${String(prop)} is static-core — optimizer cannot mutate`,
        );
      },
      defineProperty(_t, prop) {
        recordSecurityEvent(self._sandbox, {
          kind: "breaker",
          path: `rollbackThreshold.${String(prop)}`,
          reason: "rollbackThreshold is static-core (frozen); optimizer cannot redefine",
        });
        throw new BreakerError(
          `breaker: rollbackThreshold.${String(prop)} is static-core — cannot redefine`,
        );
      },
      deleteProperty(_t, prop) {
        recordSecurityEvent(self._sandbox, {
          kind: "breaker",
          path: `rollbackThreshold.${String(prop)}`,
          reason: "rollbackThreshold is static-core (frozen); optimizer cannot delete",
        });
        throw new BreakerError(
          `breaker: rollbackThreshold.${String(prop)} is static-core — cannot delete`,
        );
      },
    });
  }

  /**
   * Publish a canary shadow at `ratio` (default 5%). Returns a handle
   * identifying the shadow. The full canary release pipeline lives in CE-T06;
   * L3-T08 only records the shadow for revert-target correlation.
   */
  publishShadow(mutant: Mutant, ratio = 0.05): CanaryHandle {
    const handle: CanaryHandle = {
      mutantId: mutant.id,
      ratio,
      baselineSha: mutant.parentSha,
    };
    this._shadow = handle;
    return handle;
  }

  /**
   * Handle a regression signal. Reverts (calls `revertExec(toSha)`) when the
   * signal breaches the frozen threshold. `pii_leak` always reverts
   * (zero-tolerance). Returns `{reverted, toSha}`.
   */
  async onRegressionSignal(signal: RegressionSignal): Promise<RevertResult> {
    const toSha = this._shadow?.baselineSha ?? this._baselineSha;

    if (signal.kind === "pii_leak") {
      // Zero-tolerance: revert immediately regardless of severity.
      await this._revertExec(toSha);
      return { reverted: true, toSha };
    }

    const key = thresholdKeyFor(signal.kind);
    const limit = key ? (this.rollbackThreshold[key] ?? 0) : 0;
    const breached = signal.severity > limit;

    if (breached) {
      await this._revertExec(toSha);
      return { reverted: true, toSha };
    }
    return { reverted: false, toSha };
  }
}
