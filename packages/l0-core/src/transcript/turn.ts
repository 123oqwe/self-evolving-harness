// L0C-T02 · Turn state machine + flush queue + boundary insertion-point check.
//
// Spec: execution/L0-core/TASKS.md §L0C-T02 (ERRATA-amended).
// Mirrors pi AgentSession `_pendingCustomMessages` flush discipline: flush is
// destructive (clears the queue, not replayable) and is only permitted at
// `turn_end` (every tool_use has a matching tool_result). Flushing at
// mid_turn would inject context-only messages between a tool_use and its
// tool_result → orphan tool_use_id → provider 400.

import type {
  AssistantMessage,
  ToolResult,
  TurnStateMachine,
} from "./types.js";
import { pairToolUses } from "./tool-use-id.js";

type Phase = "awaiting_tool_results" | "turn_end";

/**
 * Create a turn state machine from an assistant message and the tool_results
 * that have arrived so far.
 *
 * Phase derivation:
 *  - if every `tool_use` in `assistant.content` has a matching (by id)
 *    `tool_result` in `toolResults` → `"turn_end"`;
 *  - otherwise → `"awaiting_tool_results"` (= mid_turn).
 *
 * The machine holds a private `_pending` queue representing context-only
 * messages. The queue is never exposed for inspection/enqueue (per spec);
 * `flushPending` is the only observable surface, and its behavior is
 * destructive: at mid_turn it throws (rejected), at turn_end it succeeds and
 * clears the queue (cannot be replayed).
 */
export function createTurnStateMachine(
  assistant: AssistantMessage,
  toolResults: ToolResult[],
): TurnStateMachine {
  return new TurnStateMachineImpl(assistant, toolResults);
}

class TurnStateMachineImpl implements TurnStateMachine {
  #phase: Phase;
  #pending: unknown[] = [];

  constructor(assistant: AssistantMessage, toolResults: ToolResult[]) {
    const toolUseIds = assistant.content
      .filter((b) => b.type === "tool_use")
      .map((b) => (b as { id: string }).id);
    const resultIds = pairToolUses(toolResults);
    const allPaired =
      toolUseIds.length > 0
        ? toolUseIds.every((id) => resultIds.has(id))
        : // No tool_use → vacuously at turn_end (assistant produced a final
          // answer with no tool calls).
          true;
    this.#phase = allPaired ? "turn_end" : "awaiting_tool_results";
  }

  isLegalInsertionPoint(point: "mid_turn" | "turn_end"): boolean {
    // `turn_end` is the ONLY legal insertion point for context-only messages,
    // and only when we are actually at turn_end (all tool_results paired).
    return point === "turn_end" && this.#phase === "turn_end";
  }

  flushPending(): void {
    if (this.#phase !== "turn_end") {
      throw new Error(
        "flushPending rejected: not at turn_end (mid_turn insertion would orphan tool_use_id)",
      );
    }
    // Destructive clear — queue cannot be replayed (mirrors pi
    // `_flushPendingCustomMessages`).
    this.#pending = [];
  }
}
