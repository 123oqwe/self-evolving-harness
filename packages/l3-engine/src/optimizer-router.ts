// L3-engine · optimizer router.
//
// Spec: execution/L3-engine/TASKS.md §L3-T01 (路由器). Routes a substrate
// `kind` to its optimizer:
//   - prompt   → GEPA 降配 beam-search (T02 injects the real instance; here a
//                stub Optimizer satisfying the interface shape so T01 can
//                assert `routeOptimizer('prompt')` is non-null with a
//                `generate` function).
//   - workflow → AFlow [V2 placeholder] → throws NotImplemented (MVP unsupported)
//   - skill    → evolve-skill-adapter [T09] → throws NotImplemented until landed
//   - weight   → null (channel default off; PRD §6.1 N1 invariant)
//
// The route table is immutable through the public contract (Object.freeze on
// the function; no public setter is exposed to flip a channel off→on at
// runtime — the breaker rejects any such attempt).

import type { Optimizer, SubstrateKind } from "./types.js";
import { NotImplemented } from "./breaker.js";

// ---------------------------------------------------------------------------
// Stub prompt optimizer (T02 replaces this with BeamSearchOptimizer injection)
// ---------------------------------------------------------------------------

const promptOptimizer: Optimizer = {
  async generate(): Promise<import("./types.js").Mutant[]> {
    // T01 stub: the real GEPA beam-search lands in T02. Returning an empty
    // candidate set keeps the interface honest without faking evolution.
    return [];
  },
};

// ---------------------------------------------------------------------------
// Route table (frozen ReadonlyMap; REFACTOR step)
// ---------------------------------------------------------------------------

const ROUTE_TABLE: ReadonlyMap<SubstrateKind, "prompt-stub" | "off" | "v2"> =
  new Map<SubstrateKind, "prompt-stub" | "off" | "v2">([
    ["prompt", "prompt-stub"],
    ["weight", "off"],
    ["workflow", "v2"],
    ["skill", "v2"],
  ]);

// ---------------------------------------------------------------------------
// routeOptimizer — public route entry
// ---------------------------------------------------------------------------

/**
 * Resolve the optimizer for a substrate kind.
 *
 * - `prompt`   → non-null Optimizer (stub in T01, real in T02).
 * - `weight`   → `null` (channel default off).
 * - `workflow` / `skill` → throws `NotImplemented` (V2 / T09 placeholder).
 *
 * The function itself is frozen so no public setter (`setEnabled` / `set` /
 * `enable`) can be attached to flip a channel at runtime.
 */
export function routeOptimizer(kind: SubstrateKind): Optimizer | null {
  const route = ROUTE_TABLE.get(kind);
  switch (route) {
    case "prompt-stub":
      return promptOptimizer;
    case "off":
      return null;
    case "v2":
      throw new NotImplemented(
        `L3-T01: optimizer for substrate kind '${kind}' is not implemented (V2/T09 placeholder)`,
      );
    default:
      throw new NotImplemented(
        `L3-T01: unknown substrate kind '${kind}' — no optimizer route`,
      );
  }
}

Object.freeze(routeOptimizer);
