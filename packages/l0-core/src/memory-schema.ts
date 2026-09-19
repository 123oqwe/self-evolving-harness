// CLN-T01 · L0C-T06 schema migration to real @sinclair/typebox.
//
// Spec: execution/cleanup/TASKS.md §CLN-T01 (ERRATA-w01 §BC-1).
//
// L0C-T06 originally exported `MemoryCommand` as a pure string-literal
// union type (no runtime schema) and `MemoryToolInputSchema` as a
// hand-written frozen descriptor object. This module migrates the
// *input schema* to a genuine `@sinclair/typebox` discriminated union of
// `Type.Object`s so runtime validation (`Value.Check`) and compile-time
// TS types are co-sourced via `Static<typeof MemoryCommand>`. The
// external contract (the six command shapes consumed by the locked
// L0C-T06 spec) is unchanged: each variant is strict
// (`additionalProperties:false`) with the same
// command/path/old_str/new_str/insert_line/content/new_path fields and
// the same optional/required split (`view.path` optional).
//
// `validateMemoryCommand` (the manual validator in `six-commands.ts`) is
// retained as the primary validation entry point — its accept/reject
// behaviour is asserted by both L0C-T06 and CLN-T01 to stay identical
// (incl. the `str_replace` `old_str` uniqueness guard, ERRATA-w01
// §L0C-T06-A3). The typebox `MemoryCommand` schema here is the canonical
// runtime contract consumed by Wave 2 canary/verifier 二次校验;
// `Value.Check(MemoryCommand, input)` accept/reject is asserted by
// CLN-T01 to match the manual guard path.

import { Type, type Static } from "@sinclair/typebox";

/** `view` — path is optional (read-only peek; caller may omit path). */
const ViewCmd = Type.Object(
  {
    command: Type.Literal("view"),
    path: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/** `create` — write a new memory file (refuses overwrite at a higher layer). */
const CreateCmd = Type.Object(
  {
    command: Type.Literal("create"),
    path: Type.String(),
    content: Type.String(),
  },
  { additionalProperties: false },
);

/** `str_replace` — unique-match text replacement (`old_str` unique). */
const StrReplaceCmd = Type.Object(
  {
    command: Type.Literal("str_replace"),
    path: Type.String(),
    old_str: Type.String(),
    new_str: Type.String(),
  },
  { additionalProperties: false },
);

/** `insert` — line-targeted insertion (`insert_line` 1-based). */
const InsertCmd = Type.Object(
  {
    command: Type.Literal("insert"),
    path: Type.String(),
    insert_line: Type.Number(),
    content: Type.String(),
  },
  { additionalProperties: false },
);

/** `delete` — remove a memory file. */
const DeleteCmd = Type.Object(
  {
    command: Type.Literal("delete"),
    path: Type.String(),
  },
  { additionalProperties: false },
);

/** `rename` — move a memory file. */
const RenameCmd = Type.Object(
  {
    command: Type.Literal("rename"),
    path: Type.String(),
    new_path: Type.String(),
  },
  { additionalProperties: false },
);

/**
 * Discriminated union of the six memory-tool command input schemas. Each
 * variant is `additionalProperties:false` and discriminated by the
 * `command` literal. Runtime-validated via `Value.Check(MemoryCommand,
 * input)`; accept/reject matches the manual `validateMemoryCommand`
 * guard path.
 */
export const MemoryCommand = Type.Union([
  ViewCmd,
  CreateCmd,
  StrReplaceCmd,
  InsertCmd,
  DeleteCmd,
  RenameCmd,
]);
export type MemoryCommand = Static<typeof MemoryCommand>;
