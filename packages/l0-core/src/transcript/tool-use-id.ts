// L0C-T02 · tool_use_id pairing + content normalization.
//
// Spec: execution/L0-core/TASKS.md §L0C-T02.
// Anthropic Messages API returns HTTP 400 for an orphan tool_result (a
// tool_result whose tool_use_id has no preceding matching tool_use). We
// mirror that contract: {@link OrphanToolResultError}.statusCode === 400.

import type { ContentBlock } from "./types.js";

/**
 * Error raised when a `tool_result` cannot be paired with a preceding
 * `tool_use` (missing / mismatched / duplicated / out-of-order id).
 *
 * `statusCode` is pinned to `400` to match the provider contract — NOT 422.
 */
export class OrphanToolResultError extends Error {
  readonly statusCode: 400;

  constructor(message: string) {
    super(message);
    this.name = "OrphanToolResultError";
    this.statusCode = 400;
  }
}

/**
 * Validate that every `tool_result` in a flat transcript has exactly one
 * preceding matching `tool_use`, and every `tool_use` is paired with exactly
 * one `tool_result`.
 *
 * Rules (any violation throws {@link OrphanToolResultError}):
 *  - a `tool_result` whose `tool_use_id` has no preceding `tool_use` (orphan);
 *  - a `tool_result` whose `tool_use_id` does not match any `tool_use`
 *    (mismatch — same as orphan from the provider's view);
 *  - a `tool_result` appearing before its `tool_use` (locks "follows" order);
 *  - a duplicate `tool_use` id;
 *  - a duplicate `tool_result` for the same id;
 *  - a `tool_use` with no matching `tool_result` at end of transcript.
 *
 * `text` / `image` blocks are ignored — only tool_use/tool_result pairing is
 * validated here.
 */
export function assertToolUsePaired(transcript: ContentBlock[]): void {
  // id -> has a matching tool_result yet
  const toolUseHasResult = new Map<string, boolean>();
  const toolResultIds = new Set<string>();

  for (const block of transcript) {
    if (block.type === "tool_use") {
      if (toolUseHasResult.has(block.id)) {
        throw new OrphanToolResultError(
          `duplicate tool_use id: ${block.id}`,
        );
      }
      toolUseHasResult.set(block.id, false);
    } else if (block.type === "tool_result") {
      if (toolResultIds.has(block.tool_use_id)) {
        throw new OrphanToolResultError(
          `duplicate tool_result for id: ${block.tool_use_id}`,
        );
      }
      const hasToolUse = toolUseHasResult.has(block.tool_use_id);
      if (!hasToolUse) {
        // No preceding tool_use with this id → orphan (covers "no tool_use at
        // all" and "id mismatch" and "result before use" cases).
        throw new OrphanToolResultError(
          `orphan tool_result (no preceding tool_use): ${block.tool_use_id}`,
        );
      }
      toolUseHasResult.set(block.tool_use_id, true);
      toolResultIds.add(block.tool_use_id);
    }
  }

  // Every tool_use must end up paired with a tool_result.
  for (const [id, hasResult] of toolUseHasResult) {
    if (!hasResult) {
      throw new OrphanToolResultError(`unpaired tool_use: ${id}`);
    }
  }
}

/**
 * Pure helper: build a map of `id -> tool_use` for the given tool_results'
 * target ids. Used by the turn state machine to derive phase.
 */
export function pairToolUses(
  toolResults: ReadonlyArray<{ tool_use_id: string }>,
): Set<string> {
  const ids = new Set<string>();
  for (const r of toolResults) {
    ids.add(r.tool_use_id);
  }
  return ids;
}

/**
 * Normalize a content block: reject `null`/`undefined` anywhere in the block
 * (including recursively inside a `tool_result.content` array and inside an
 * image source). For legal input, returns an equivalent block unchanged
 * (no trim / no transformation).
 *
 * @throws Error if any null/undefined content is found.
 */
export function normalizeContent(block: ContentBlock): ContentBlock {
  return normalizeBlock(block);
}

function normalizeBlock(block: ContentBlock): ContentBlock {
  switch (block.type) {
    case "text":
      if (block.text == null) {
        throw new Error("normalizeContent: null text content");
      }
      return block;

    case "image":
      if (block.source == null) {
        throw new Error("normalizeContent: null image source");
      }
      if (block.source.data == null) {
        throw new Error("normalizeContent: null image data");
      }
      if (block.source.media_type == null) {
        throw new Error("normalizeContent: null image media_type");
      }
      return block;

    case "tool_use":
      if (block.id == null) {
        throw new Error("normalizeContent: null tool_use id");
      }
      if (block.name == null) {
        throw new Error("normalizeContent: null tool_use name");
      }
      return block;

    case "tool_result": {
      if (block.content == null) {
        throw new Error("normalizeContent: null tool_result content");
      }
      if (typeof block.content === "string") {
        return block;
      }
      // content is ContentBlock[] — recurse, reject null elements.
      for (const child of block.content) {
        if (child == null) {
          throw new Error(
            "normalizeContent: null element in tool_result content array",
          );
        }
        normalizeBlock(child);
      }
      return block;
    }

    default: {
      // Exhaustiveness guard — should be unreachable.
      const _exhaustive: never = block;
      void _exhaustive;
      throw new Error(`normalizeContent: unknown block type`);
    }
  }
}
