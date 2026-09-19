// L0C-T06 · Memory tool six-command input schema (static-core).
//
// Spec: execution/L0-core/TASKS.md §L0C-T06 (ERRATA-amended).
//
// The memory tool command set is itself a static-core invariant
// (research/02-memory-skills.md §3(b): "changing the command set breaks the
// tool-use contract with the model"). This module defines the *input schema*
// contract only — execution lives in L2-T02. L0C exports the schema +
// validators so L2 can align against a single canonical source of truth.
//
// ERRATA裁决:
//  - `MemoryCommand` is exported as a string-literal union type.
//  - typebox is NOT in the locked dependency set and the implementer rules
//    forbid adding new deps; `MemoryToolInputSchema` is therefore exported
//    as a plain frozen descriptor object (mirrors the T03 approach), and
//    `validateMemoryCommand` performs manual validation with equivalent
//    strict semantics (`additionalProperties:false` == reject extra keys).
//    The runtime contract the tests assert is unchanged.

/** Canonical memory root. All memory paths must live strictly under this. */
export const MEMORY_ROOT = "/memories/";

/** The six memory-tool commands (locked set). */
export type MemoryCommand =
  | "view"
  | "create"
  | "str_replace"
  | "insert"
  | "delete"
  | "rename";

/** Primitive type tags used by the manual schema validator. */
type TypeTag = "string" | "number";

interface CommandVariantSpec {
  /** Required fields → primitive type. */
  readonly fields: Readonly<Record<string, TypeTag>>;
  /** Optional fields → primitive type. */
  readonly optional?: Readonly<Record<string, TypeTag>>;
}

/** Per-command strict shape spec (`additionalProperties:false` semantics). */
const COMMAND_SPECS: Readonly<Record<MemoryCommand, CommandVariantSpec>> = {
  view: {
    fields: {},
    optional: { path: "string" },
  },
  create: {
    fields: { path: "string", content: "string" },
  },
  str_replace: {
    fields: { path: "string", old_str: "string", new_str: "string" },
  },
  insert: {
    fields: { path: "string", insert_line: "number", content: "string" },
  },
  delete: {
    fields: { path: "string" },
  },
  rename: {
    fields: { path: "string", new_path: "string" },
  },
};

/**
 * Strict input schema descriptor for the six memory commands (typebox-style
 * union, materialised as a frozen plain object — see file header). Each
 * variant is `additionalProperties:false`.
 */
export const MemoryToolInputSchema = Object.freeze({
  type: "union",
  additionalProperties: false,
  anyOf: Object.freeze(
    (Object.keys(COMMAND_SPECS) as MemoryCommand[]).map((cmd) =>
      Object.freeze({
        type: "object",
        additionalProperties: false,
        command: cmd,
        required: Object.freeze([
          "command",
          ...Object.keys(COMMAND_SPECS[cmd]!.fields),
        ]),
        properties: Object.freeze({
          command: Object.freeze({ type: "literal", const: cmd }),
          ...Object.fromEntries(
            Object.entries(COMMAND_SPECS[cmd]!.fields).map(([k, t]) => [
              k,
              Object.freeze({ type: t }),
            ]),
          ),
          ...Object.fromEntries(
            Object.entries(COMMAND_SPECS[cmd]!.optional ?? {}).map(
              ([k, t]) => [k, Object.freeze({ type: t })],
            ),
          ),
        }),
      }),
    ),
  ),
} as const);

/** Validation result — discriminated by `ok`. */
export type ValidateMemoryCommandResult =
  | { readonly ok: true; readonly command: MemoryCommand }
  | { readonly ok: false; readonly error: string };

/**
 * Validate an unknown `input` against the six-command schema with strict
 * (`additionalProperties:false`) semantics. Returns `{ok:true, command}` on
 * a valid command, or `{ok:false, error}` otherwise. Never throws.
 */
export function validateMemoryCommand(
  input: unknown,
): ValidateMemoryCommandResult {
  // Reject non-object, null, and arrays — commands are plain objects.
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "memory command must be a non-array object" };
  }
  const obj = input as Record<string, unknown>;

  const cmd = obj["command"];
  if (typeof cmd !== "string") {
    return { ok: false, error: "command must be a string literal" };
  }
  const spec = COMMAND_SPECS[cmd as MemoryCommand];
  if (!spec) {
    return { ok: false, error: `unknown command: ${cmd}` };
  }

  // additionalProperties:false — any key outside the allowed set rejects.
  const allowed = new Set<string>(["command"]);
  for (const k of Object.keys(spec.fields)) allowed.add(k);
  if (spec.optional) {
    for (const k of Object.keys(spec.optional)) allowed.add(k);
  }
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      return {
        ok: false,
        error: `unexpected field \`${key}\` for command \`${cmd}\` (strict schema)`,
      };
    }
  }

  // Required fields — present with correct primitive type.
  for (const [field, tag] of Object.entries(spec.fields)) {
    if (!(field in obj)) {
      return { ok: false, error: `missing required field \`${field}\` for command \`${cmd}\`` };
    }
    if (!matchesType(obj[field], tag)) {
      return { ok: false, error: `field \`${field}\` must be ${tag} for command \`${cmd}\`` };
    }
  }

  // Optional fields — when present, must match their declared type.
  if (spec.optional) {
    for (const [field, tag] of Object.entries(spec.optional)) {
      if (field in obj && !matchesType(obj[field], tag)) {
        return { ok: false, error: `optional field \`${field}\` must be ${tag} for command \`${cmd}\`` };
      }
    }
  }

  return { ok: true, command: cmd as MemoryCommand };
}

function matchesType(value: unknown, tag: TypeTag): boolean {
  if (tag === "string") return typeof value === "string";
  if (tag === "number") return typeof value === "number" && Number.isFinite(value);
  return false;
}

/**
 * Reject path-traversal / root-operation / out-of-root memory paths.
 *
 * Defends against `../`, `%2e%2e` (URL-encoded), and operating on the
 * `/memories` root itself. Both `/memories` and `/memories/` are rejected as
 * root operations (no trailing child segment).
 */
export function assertCanonicalPath(path: string): void {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("memory path must be a non-empty string");
  }

  // Decode URI escapes first so encoded traversal (`%2e%2e`) is caught by
  // the same segment check as literal `..`.
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
      throw new Error(`memory path contains a malformed URI escape: ${path}`);
  }

  // Reject any `..` path segment — literal or decoded. (Segment-level check
  // so legitimate filenames containing `..` substrings are not affected.)
  const segments = decoded.split("/");
  if (segments.some((seg) => seg === "..")) {
    throw new Error(
      `memory path rejects traversal segment \`..\`: ${path}`,
    );
  }

  // Defensive: reject any residual percent-encoded dot escapes.
  if (/%2e/i.test(path)) {
    throw new Error(
      `memory path rejects encoded traversal \`%2e\`: ${path}`,
    );
  }

  // Must live strictly under the memory root with a non-empty remainder.
  if (!decoded.startsWith(MEMORY_ROOT)) {
    throw new Error(
      `memory path must be under ${MEMORY_ROOT}: ${path}`,
    );
  }
  const remainder = decoded.slice(MEMORY_ROOT.length);
  if (remainder.length === 0) {
    throw new Error(
      `memory path rejects operating on the root \`${MEMORY_ROOT}\`: ${path}`,
    );
  }
}

/**
 * Assert `old_str` occurs exactly once in `content`. Zero matches or
 * multiple matches both throw — the memory tool reference mandates a unique
 * match and never silently mutates the "wrong" occurrence.
 */
export function assertStrReplaceUnique(
  content: string,
  old_str: string,
): void {
  if (typeof content !== "string" || typeof old_str !== "string") {
    throw new Error("assertStrReplaceUnique: content and old_str must be strings");
  }
  if (old_str.length === 0) {
    throw new Error("assertStrReplaceUnique: old_str must be non-empty");
  }
  // Count non-overlapping occurrences via split-and-count.
  const count = content.split(old_str).length - 1;
  if (count !== 1) {
    throw new Error(
      `str_replace requires exactly one match of old_str; found ${count}`,
    );
  }
}

/**
 * Assert a `create` target does not already exist. `exists === true` throws
 * — `create` refuses to overwrite (never-auto-delete / no-silent-clobber
 * invariant, PRD §6.6).
 */
export function assertCreateNoOverwrite(exists: boolean): void {
  if (exists) {
    throw new Error(
      "create refuses to overwrite an existing memory (never-auto-delete / no-silent-clobber)",
    );
  }
}
