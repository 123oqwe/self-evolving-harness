// L3-T03 prompt template (REFACTOR: externalised for L1 substrate-evolution
// loop reuse). Read at call time so edits take effect without a recompile
// boundary change in the package surface.
//
// Spec: execution/L3-engine/TASKS.md §L3-T03 REFACTOR.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(__dirname, "reflective-mutation.md");

let cached: string | null = null;

/**
 * Read the reflective-mutation prompt template. Memoised after first read.
 * Falls back to an inline template if the `.md` file is absent (keeps the
 * port usable in bundling contexts that drop sibling assets).
 */
export function readReflectivePrompt(): string {
  if (cached !== null) return cached;
  try {
    cached = readFileSync(TEMPLATE_PATH, "utf8");
  } catch {
    cached =
      "You are a reflective mutation engine (GEPA-reduced). " +
      "Read the failure diagnoses for the substrate below and rewrite the " +
      "substrate to fix the diagnosed failures without regressing correctness.";
  }
  return cached;
}
