// L3 test fixtures — deterministic PRNG + string hash helpers.
//
// Shared by FakeEvaluator / IslandArchive (T06b) / surrogate (T11) / MCTS (T14)
// to guarantee seed-fixed convergence assertions. Pure functions, no deps on
// the (unimplemented) @harness/l3-engine runtime — only type-level alignment.

/** mulberry32 PRNG — deterministic [0,1) from a 32-bit seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable string→uint32 hash (FNV-1a variant) for seeding PRNG from ids. */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Convenience: a PRNG seeded by a string label. */
export function seededPrng(label: string, seed = 42): () => number {
  return mulberry32(hashStr(`${label}:${seed}`));
}
