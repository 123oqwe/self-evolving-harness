// CLN-T01 · L0C-T03 schema migration to real @sinclair/typebox.
//
// Spec: execution/cleanup/TASKS.md §CLN-T01 (ERRATA-w01 §BC-1).
//
// L0C-T03 originally exported `StopReason` / `StopDecision` as pure TS
// types (type alias + interface) with no runtime schema object, and the
// stop-decision layer set was carried only by the `StopLayer` alias in
// `stop/stop-conditions.ts`. This module migrates the *stop-decision
// schema* to genuine `@sinclair/typebox` `Type.Union` / `Type.Object`
// definitions so runtime validation (`Value.Check`) and compile-time TS
// types are co-sourced via `Static<typeof X>`. The external contract (the
// shape consumed by the locked L0C-T03 spec) is unchanged: `stop` /
// `layer` / `reason` with strict (`additionalProperties:false`) semantics.
//
// Distinct from the wire-level `StopReason` union in
// `transcript/types.ts` (which carries the 6 model-facing stop-reason
// literals incl. `tool_use`/`error`/`length`/`aborted`). The two are
// intentionally separate schemas: this is the *stop-decision* schema set
// consumed by Wave 2 canary/verifier runtime 二次校验, not the wire
// stop-reason set. Do not merge the layer/reason unions.

import { Type, type Static } from "@sinclair/typebox";

/**
 * Stop-decision-layer literals — the canonical 4-layer set used by
 * {@link StopDecision}. Runtime-validated via `Value.Check(StopReason, v)`.
 *
 * Distinct from the wire-level `StopReason` union in `transcript/types.ts`.
 */
export const StopReason = Type.Union([
  Type.Literal("end_turn"),
  Type.Literal("max_turns"),
  Type.Literal("api_error"),
  Type.Literal("abort"),
]);
export type StopReason = Static<typeof StopReason>;

/**
 * Strict stop-decision schema: `{ stop: boolean, layer: StopReason, reason:
 * string }` with `additionalProperties:false`. Runtime-validated via
 * `Value.Check(StopDecision, v)`; reject semantics match the original
 * frozen-descriptor guard path (reject missing/extra/wrong-type fields).
 */
export const StopDecision = Type.Object(
  {
    stop: Type.Boolean(),
    layer: Type.Union([
      Type.Literal("end_turn"),
      Type.Literal("max_turns"),
      Type.Literal("api_error"),
      Type.Literal("abort"),
    ]),
    reason: Type.String(),
  },
  { additionalProperties: false },
);
export type StopDecision = Static<typeof StopDecision>;
