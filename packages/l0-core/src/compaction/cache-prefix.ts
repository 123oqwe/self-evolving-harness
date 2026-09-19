// L0C-T05 · cache_control exact-prefix contract.
//
// Spec: execution/L0-core/TASKS.md §L0C-T05 (ERRATA-amended signatures).
//
// Invariant (PRD §6.6 / Anthropic prompt-caching exact-prefix match):
//  - Anthropic prompt caching matches on an *exact* stable prefix. Mutating
//    the stable prefix invalidates the cache → a near-full re-compute, i.e.
//    ~10x cost for that turn. This is the "10x cost" invariant.
//  - Legitimate prompt evolution *may* change the prefix, but only after an
//    explicit canary pass. Therefore `assertStablePrefix` does NOT throw on a
//    mismatch; it only emits a `CachePrefixViolation` event so telemetry /
//    invariant tests can observe (and fail closed at the canary gate).
//  - ERRATA裁决: the violation channel is exposed as a *subscription
//    function* `onCachePrefixViolation` (returns an unsubscribe callback),
//    NOT a mutable singleton or an EventEmitter-style export — static-core
//    forbids mutable-singleton exports (PRD §6.6). `assertStablePrefixUntouched`
//    is the compaction-side guard exported from `cut-boundary.ts`.

/**
 * Marker interface binding a prompt to its stable-prefix hash anchor. The hash
 * is the cache_control exact-prefix identity; two prompts with the same
 * `stablePrefixHash` share a cache entry.
 */
export interface CachePrefixContract {
  readonly stablePrefixHash: string;
}

/**
 * Event emitted when the stable cache prefix changes between two submissions.
 * Carries the old/new hashes so telemetry can attribute the 10x cost.
 */
export interface CachePrefixViolationEvent {
  readonly type: "CachePrefixViolation";
  readonly oldHash: string;
  readonly newHash: string;
}

/**
 * Whether the stable prefix is untouchable by compaction. Always `true` — a
 * compile-time anchor for invariant tests asserting the contract is in force.
 */
export const STABLE_PREFIX_UNTOUCHABLE = true as const;

// Internal subscriber set. Module-private mutable state is permitted as long
// as it is not exported as a mutable singleton (the only exports are the pure
// subscription function + the assert function + types/constants).
const subscribers = new Set<(event: CachePrefixViolationEvent) => void>();

/**
 * Subscribe to `CachePrefixViolation` events. Returns an unsubscribe callback.
 *
 * ERRATA裁决: subscription-function shape (not a singleton/EventEmitter) to
 * avoid mutable-singleton exports conflicting with static-core constraints.
 */
export function onCachePrefixViolation(
  handler: (event: CachePrefixViolationEvent) => void,
): () => void {
  subscribers.add(handler);
  return () => {
    subscribers.delete(handler);
  };
}

/**
 * Assert the stable cache prefix is unchanged between two submissions.
 *
 * - `oldHash === newHash` → pass silently (no event).
 * - `oldHash !== newHash` → emit a `CachePrefixViolation` event (10x cost
 *   invariant alert). Does NOT throw: legitimate prompt evolution may change
 *   the prefix, but it must be gated by an explicit canary pass elsewhere.
 *
 * Handler exceptions are swallowed so a misbehaving subscriber cannot crash the
 * core loop or suppress emission to later subscribers.
 */
export function assertStablePrefix(oldHash: string, newHash: string): void {
  if (oldHash === newHash) {
    return;
  }
  const event: CachePrefixViolationEvent = {
    type: "CachePrefixViolation",
    oldHash,
    newHash,
  };
  for (const handler of subscribers) {
    try {
      handler(event);
    } catch {
      // A throwing telemetry subscriber must not break the core loop or
      // block later subscribers from observing the violation.
    }
  }
}
