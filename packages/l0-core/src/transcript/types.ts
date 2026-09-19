// L0C-T02 · Turn / Transcript protocol types.
//
// Spec: execution/L0-core/TASKS.md §L0C-T02 (ERRATA-amended signatures).
// turn = one assistant message + the batch of all tool_results it triggered.
// tool_use_id pairing + content normalization are state-machine invariants;
// mutating them produces an orphan tool_use_id → provider 400.

/** A base64-encoded image source (Anthropic Messages API image block). */
export type ImageSource = {
  type: "base64";
  media_type: string;
  data: string;
};

/**
 * A single content block within an assistant/user message.
 *
 * `tool_result` is included here (not just in a separate results array) so
 * that a flat transcript `ContentBlock[]` can be validated end-to-end by
 * {@link assertToolUsePaired}.
 */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: ImageSource }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: ContentBlock[] | string;
      is_error?: boolean;
    };

/** Why the model stopped producing this turn. */
export type StopReason =
  | "end_turn"
  | "tool_use"
  | "max_turns"
  | "error"
  | "length"
  | "aborted";

/** An assistant turn message. `stop_reason` is optional on the wire. */
export interface AssistantMessage {
  readonly role: "assistant";
  readonly content: ContentBlock[];
  readonly stop_reason?: StopReason;
}

/** A `tool_result` content block, extracted as its own type. */
export type ToolResult = Extract<ContentBlock, { type: "tool_result" }>;

/**
 * A turn = one assistant message + every tool_result it triggered, as a batch.
 * `turnIndex` is the 0-based position of this turn in the transcript.
 */
export interface Turn {
  readonly assistant: AssistantMessage;
  readonly toolResults: ToolResult[];
  readonly turnIndex: number;
}

/**
 * State machine over a turn's two phases:
 *  - `"awaiting_tool_results"` (mid_turn): at least one tool_use lacks a
 *    matching tool_result.
 *  - `"turn_end"`: every tool_use has a matching tool_result.
 *
 * `turn_end` is the *only* legal insertion point for context-only messages
 * (`_pendingCustomMessages`). Flushing at mid_turn is rejected to prevent
 * orphan tool_use_ids.
 */
export interface TurnStateMachine {
  isLegalInsertionPoint(point: "mid_turn" | "turn_end"): boolean;
  flushPending(): void;
}
