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
