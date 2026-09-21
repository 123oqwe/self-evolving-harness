// L3-T12 REFACTOR: per-variable boundary parser.
//
// Spec: execution/L3-engine/TASKS.md §L3-T12 (REFACTOR — "变量边界解析抽
// variable-parser.ts (L1 基质分段复用)").
//
// TextGrad's defining difference vs L3-T03 reflective mutation is
// per-variable isolation: each optimisable variable (instruction segment,
// few-shot demo segment, tool-description segment) receives its own
// independent text gradient, and a gradient on variable A must never
// leak into variable B's content. That isolation requires a deterministic
// variable-boundary parser that splits a prompt/skill substrate into
// ordered `TextGradVariable` records.
//
// MVP uses a fixed segment marker (`\n---\n`) to delimit variables — the
// spec's "执行提示 (2)" explicitly defers real L1 prompt-segment / L2
// skill description|body parsing to L1-T03/L2-T01. The parser is pure and
// reassemble-able so `applyGradients` can stitch patched variables back
// into a single `Mutant.content` without drift.

import type { TextGradVariable } from "./textgrad.js";

/**
 * Fixed segment delimiter for the MVP variable-boundary parser.
 * L1-T03 / L2-T01 replace this with structure-aware segmentation.
 */
export const SEGMENT_SEPARATOR = "\n---\n";

/**
 * Ordered role assignment for parsed segments. The first segment is the
 * instruction (primary steering), the second is the few-shot demo, and
 * any further segments are tool-description slots.
 */
function roleForIndex(index: number): TextGradVariable["role"] {
  if (index === 0) return "instruction";
  if (index === 1) return "demo";
  return "description";
}

/**
 * Stable variable id derived from the segment role + ordinal. Stable ids
 * let `backprop` route `TextLoss.perVar` feedback and `applyGradients`
 * re-find the patched content for the same variable across calls.
 */
function idForRole(role: TextGradVariable["role"], ordinal: number): string {
  if (role === "description") return `description-${ordinal}`;
  return role; // "instruction" | "demo" — singletons in MVP.
}

/**
 * Split a prompt/skill substrate `content` into ordered `TextGradVariable`
 * records. Pure & deterministic: the same content always yields the same
 * variable list (same ids, same roles, same content slices).
 *
 * - Empty content → single instruction variable with empty content (so a
 *   blank substrate still has one optimisable variable rather than zero,
 *   which would short-circuit the reverse pass).
 * - Trailing separator is tolerated (no phantom empty trailing variable).
 */
export function parseVariables(content: string): TextGradVariable[] {
  const trimmed = content.replace(/\r\n/g, "\n");
  // Tolerate a single trailing separator (no phantom empty trailing var).
  const body = trimmed.endsWith(SEGMENT_SEPARATOR)
    ? trimmed.slice(0, -SEGMENT_SEPARATOR.length)
    : trimmed;
  const segments = body.split(SEGMENT_SEPARATOR);
  const out: TextGradVariable[] = [];
  let descriptionOrdinal = 0;
  segments.forEach((seg, i) => {
    const role = roleForIndex(i);
    const id = idForRole(role, descriptionOrdinal);
    if (role === "description") descriptionOrdinal += 1;
    out.push({ id, content: seg, role });
  });
  if (out.length === 0) {
    out.push({ id: "instruction", content: "", role: "instruction" });
  }
  return out;
}

/**
 * Reassemble an ordered `TextGradVariable` list into a single content
 * string using the fixed segment marker. The inverse of `parseVariables`
 * so `applyGradients` can stitch patched variables back without drift.
 */
export function assembleContent(vars: TextGradVariable[]): string {
  return vars.map((v) => v.content).join(SEGMENT_SEPARATOR);
}
