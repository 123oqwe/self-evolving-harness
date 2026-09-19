// L0C-T07a · RunState schema + turn items 持久化先于 terminal 标记.
//
// Spec: execution/L0-core/TASKS.md §L0C-T07a (ERRATA-amended).
//
// `RunState` is the crash-recovery schema (versioned) carried by the loop so
// that a crash between "persist tool side-effect" and "mark terminal" does
// not, on resume, re-execute a tool whose side-effect already happened
// (duplicate side-effect invariant — OpenAI Agents SDK RunState version
// history, research/02-loop-context.md §1.6 (a)).
//
// Invariants enforced here:
//  - `serializeRunState` → `deserializeRunState` is a faithful round-trip
//    (every field, incl. `unsent_tool_call_ids_for_interrupted_state`).
//  - `markTerminalAfterPersist` refuses to flip `terminal=true` until the
//    item is `persisted=true` (order must not be inverted). The item is
//    mutated in place — `turnItems` is a mutable array by design.
//  - `assertNoResentToolCalls` post-hoc guards resume: any terminal tool_use
//    re-appearing in the executed set is a hard violation.
//  - `deserializeRunState` rejects a `version` that does not match
//    `RUN_STATE_VERSION` (schema-drift guard) and malformed JSON.

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/** Current RunState schema version. Bump (never edit in place) on schema change. */
export const RUN_STATE_VERSION = "1.0" as const;

/**
 * typebox schema for {@link RunState}. `turnItems` is intentionally modeled
 * as an array of mutable item objects (see {@link TurnItem}) so that
 * `markTerminalAfterPersist` can mutate in place.
 */
export const RunStateSchema = Type.Object({
  version: Type.Literal(RUN_STATE_VERSION),
  current_agent: Type.String(),
  _current_turn: Type.Number(),
  pending_input: Type.Unknown(),
  unsent_tool_call_ids_for_interrupted_state: Type.Array(Type.String()),
  approvals: Type.Record(
    Type.String(),
    Type.Union([
      Type.Literal("approved"),
      Type.Literal("denied"),
      Type.Literal("pending"),
    ]),
  ),
  turnItems: Type.Array(
    Type.Object({
      toolUseId: Type.String(),
      persisted: Type.Boolean(),
      terminal: Type.Boolean(),
    }),
  ),
});

/**
 * A single turn item. Mutable: `markTerminalAfterPersist` flips `terminal`
 * in place after `persisted` is already true.
 */
export interface TurnItem {
  toolUseId: string;
  persisted: boolean;
  terminal: boolean;
}

/** Approval state for a pending HITL approval key. */
export type ApprovalState = "approved" | "denied" | "pending";

/**
 * Crash-recoverable run state. `turnItems` is a mutable array (see
 * {@link markTerminalAfterPersist}); all other fields are conceptually
 * write-once-per-turn but kept as plain (non-readonly) for round-trip
 * fidelity with the schema.
 */
export interface RunState {
  version: string;
  current_agent: string;
  _current_turn: number;
  pending_input: unknown;
  unsent_tool_call_ids_for_interrupted_state: string[];
  approvals: Record<string, ApprovalState>;
  turnItems: TurnItem[];
}

/** Static type of {@link RunStateSchema} (used for decode). */
type RunStateStatic = Static<typeof RunStateSchema>;

/**
 * Predicate: is this turn item persisted AND terminal? Used by the resume
 * guard to identify items that must never be re-executed.
 */
function isTerminalPersisted(item: TurnItem): boolean {
  return item.persisted && item.terminal;
}

/**
 * Serialize a {@link RunState} to a versioned JSON string.
 *
 * The output is `JSON.stringify` of the state object; the `version` field is
 * always {@link RUN_STATE_VERSION}.
 */
export function serializeRunState(state: RunState): string {
  const plain = {
    version: RUN_STATE_VERSION,
    current_agent: state.current_agent,
    _current_turn: state._current_turn,
    pending_input: state.pending_input,
    unsent_tool_call_ids_for_interrupted_state:
      state.unsent_tool_call_ids_for_interrupted_state,
    approvals: state.approvals,
    turnItems: state.turnItems,
  };
  return JSON.stringify(plain);
}

/**
 * Deserialize a versioned JSON string back into a {@link RunState}.
 *
 * @throws Error if the JSON is malformed.
 * @throws Error if the `version` field does not equal {@link RUN_STATE_VERSION}
 *         (schema-drift guard — `/version/i` in the message).
 * @throws Error if the payload does not conform to {@link RunStateSchema}.
 */
export function deserializeRunState(json: string): RunState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(
      `deserializeRunState: malformed JSON (${(e as Error).message})`,
    );
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new Error("deserializeRunState: payload is not an object");
  }

  const obj = parsed as { version?: unknown };
  if (obj.version !== RUN_STATE_VERSION) {
    throw new Error(
      `deserializeRunState: version mismatch — expected ${RUN_STATE_VERSION}, got ${String(
        obj?.version,
      )}`,
    );
  }

  if (!Value.Check(RunStateSchema, parsed)) {
    throw new Error("deserializeRunState: payload violates RunStateSchema");
  }

  const decoded = Value.Decode(RunStateSchema, parsed) as RunStateStatic;
  // Cast through unknown: the Static shape matches RunState structurally.
  return decoded as unknown as RunState;
}

/**
 * Mark a turn item terminal AFTER it has been persisted.
 *
 * Order invariant: `persisted` must become `true` BEFORE `terminal` flips to
 * `true`. Inverting this order means a crash between the two flips would, on
 * resume, re-execute a tool whose side-effect already landed → duplicate
 * side-effect.
 *
 * The item is mutated in place (`turnItems` is a mutable array by design).
 *
 * @throws Error if `toolUseId` is not found in `state.turnItems`.
 * @throws Error if the target item is not yet `persisted` (the message
 *         contains `/persist/i`).
 */
export function markTerminalAfterPersist(
  state: RunState,
  toolUseId: string,
): void {
  const item = state.turnItems.find((t) => t.toolUseId === toolUseId);
  if (item === undefined) {
    throw new Error(
      `markTerminalAfterPersist: unknown toolUseId: ${toolUseId}`,
    );
  }
  if (!item.persisted) {
    throw new Error(
      `markTerminalAfterPersist: item ${toolUseId} must be persisted before marking terminal (persisted=false)`,
    );
  }
  item.terminal = true;
}

/**
 * Post-hoc resume guard: assert that no terminal tool_use was re-executed
 * during resume.
 *
 * A turn item that is both `persisted` and `terminal` represents a tool call
 * whose side-effect already landed and was finalized. Re-executing it on
 * resume is a hard duplicate-side-effect violation.
 *
 * The empty set never throws (resume that re-executes nothing is fine).
 *
 * @throws Error if any terminal tool_use id appears in `executedToolUseIds`
 *         (message contains `/resent|resend|terminal|already/i`).
 */
export function assertNoResentToolCalls(
  state: RunState,
  executedToolUseIds: Set<string>,
): void {
  for (const item of state.turnItems) {
    if (isTerminalPersisted(item) && executedToolUseIds.has(item.toolUseId)) {
      throw new Error(
        `assertNoResentToolCalls: terminal tool_use ${item.toolUseId} was resent/re-executed on resume (already persisted+terminal)`,
      );
    }
  }
}
