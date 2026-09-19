// L3 test fixture — factory helpers for substrate/mutant/fitness/archive entry.
//
// Type-only imports from @harness/l3-engine are erased at transpile; the
// concrete factories produce structurally-correct plain objects usable in RED.

import type {
  Substrate,
  Mutant,
  Fitness,
  ArchiveEntry,
} from "@harness/l3-engine";

let _id = 0;
export function nextId(prefix = "m"): string {
  return `${prefix}-${++_id}`;
}

export function makeSubstrate(
  overrides: Partial<Substrate> = {},
): Substrate {
  return {
    kind: "prompt",
    content: "baseline prompt",
    sha: "sha-baseline",
    ...overrides,
  };
}

export function makeMutant(overrides: Partial<Mutant> = {}): Mutant {
  return {
    id: nextId(),
    parentSha: "sha-baseline",
    content: "mutated prompt",
    origin: "beam-search",
    ...overrides,
  };
}

export function makeFitness(
  overrides: Partial<Fitness> = {},
): Fitness {
  return {
    resolve_rate: 0.5,
    token: 100,
    cache_hit: 0.5,
    ...overrides,
  };
}

export function makeArchiveEntry(
  overrides: Partial<ArchiveEntry> = {},
): ArchiveEntry {
  return {
    sha: `sha-${nextId("a")}`,
    parentSha: null,
    mutant: makeMutant(),
    fitness: makeFitness(),
    generation: 0,
    status: "active",
    ...overrides,
  };
}
