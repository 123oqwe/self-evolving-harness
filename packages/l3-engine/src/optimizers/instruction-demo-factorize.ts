// L3-T11: instruction×demo factorize combiner — DSPy/MIPROv2's decoupled
// search over the instruction segment vs the few-shot demo segment.
//
// Spec: execution/L3-engine/TASKS.md §L3-T11.
//
// The factorize combiner takes independently-produced instruction variants
// and demo variants and yields their full cartesian product as crossed
// `Mutant`s (origin='reflective'). Decoupling the two segments lets the
// search explore the instruction×demo space without entangling their
// mutation operators (the MIPROv2 factorize insight, 03-skills.md §2.3).
//
// This module is pure (no LLM, no IO) — the LLM-driven segment proposers
// live in `dspy-mipro.ts`; this file owns only the cross operator so it can
// be unit-reused by V2 GP-surrogate sweeps.

import type { Mutant } from "../types.js";

/**
 * Cross a set of instruction variants with a set of demo variants.
 *
 * Returns `instructions.length × demos.length` crossed `Mutant`s, each
 * carrying `origin='reflective'` and `parentSha` from the parent substrate.
 * The crossed `content` concatenates the instruction and demo segments with
 * a stable separator so downstream evalutors see a single prompt string.
 *
 * Boundary: empty inputs → `[]` (no cartesian terms); no candidates are
 * synthesised.
 */
export function factorizeInstructionDemo(
  parentSha: string,
  instructions: Mutant[],
  demos: Mutant[],
  combiner: (instr: Mutant, demo: Mutant) => string = defaultCombiner,
): Mutant[] {
  const out: Mutant[] = [];
  let n = 0;
  for (const instr of instructions) {
    for (const demo of demos) {
      out.push({
        id: `mipro-${n++}`,
        parentSha,
        content: combiner(instr, demo),
        origin: "reflective",
      });
    }
  }
  return out;
}

/**
 * Default segment combiner: instruction block, separator, demo block.
 */
function defaultCombiner(instr: Mutant, demo: Mutant): string {
  return [
    "## Instruction",
    instr.content,
    "",
    "## Demos",
    demo.content,
  ].join("\n");
}
