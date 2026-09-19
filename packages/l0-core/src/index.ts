// L0C · static-core package entry.
//
// L0C-T01: version constant.
// L0C-T02: Turn / Transcript protocol contract (types + state machine +
// tool_use_id pairing + content normalization).
//
// Only `export type` + `export const`/pure-function exports. No mutable
// singletons (static-core invariant, PRD §6.6).

export const L0_CORE_VERSION = "0.1.0";

export * from "./transcript/types.js";
export * from "./transcript/tool-use-id.js";
export * from "./transcript/turn.js";
export * from "./stop/stop-conditions.js";
export * from "./retry/retry-classifier.js";
export * from "./retry/overflow-guard.js";
export * from "./compaction/cache-prefix.js";
export * from "./compaction/cut-boundary.js";
export * from "./memory-tool/progressive-disclosure.js";
export * from "./memory-tool/six-commands.js";
// CLN-T01: real typebox schemas for the stop-decision contract (L0C-T03)
// and the six memory-tool command inputs (L0C-T06). Explicit named
// re-exports override the legacy type-only star exports above so the
// barrel's `StopReason` / `StopDecision` / `MemoryCommand` bind to the
// typebox schema *values* (runtime `Value.Check`-able) while keeping the
// co-sourced `Static` types. The wire-level `StopReason` union stays
// available via `transcript/types.ts` for internal use; the manual
// `validateMemoryCommand` guard stays in `six-commands.ts`.
export { StopReason, StopDecision } from "./stop-schema.js";
export { MemoryCommand } from "./memory-schema.js";
export * from "./run-state/run-state.js";
export * from "./run-state/journal.js";
export * from "./session-log/session-log.js";
export * from "./guard/pre-commit.js";
export * from "./guard/read-only.js";
