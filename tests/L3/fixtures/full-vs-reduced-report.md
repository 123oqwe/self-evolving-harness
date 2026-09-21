# L3-T10 — full-population reflective mutation vs 降配 (T02) 对比报告

> Spec: `execution/L3-engine/TASKS.md §L3-T10` (执行提示 3: 对比报告供 CE-T11 canary 扩容决策).
> Methodology: same seed (42), `FakeEvaluator({ seed: 42 })`, `BeamSearchOptimizer({ beamWidth: 3, prngSeed: 42 })`
> vs `FullPopulationBeamSearch({ beamWidth: 3, prngSeed: 42, reflective })`.
> Locked assertion: `tests/L3/T10-full-population.spec.ts` (front ≥ reduced, mutate calls = K).

## Upgrade points (V1 vs MVP 降配 §6.7)

1. **Full-population reflective mutation** — T02 降配 reflects on the single
   best beam candidate only; V1 reflects on **every** top-K candidate
   (mutate-call count = K, not 1). Widens the variant frontier.
2. **NSGA-II layered non-dominated sort** — T02 uses single-objective
   `resolve_rate` desc + diversity tiebreak; V1 uses `fastNonDominatedSort`
   (BFS layering: rank 0 = non-dominated, rank r = points dominated by some
   rank-(r-1) member). `weightedSum` is forbidden (PRD §6.7 invariant).

## Observed result (seed=42, deterministic)

- Reduced beam: 3 candidates (`c-0`, `c-1`, `c-2`), front size = 3 (all
  mutually non-dominated on `resolve_rate ∧ token ∧ cache_hit`).
- Full population (3 top-K candidates, 1 reflective mutant each): 3 mutants,
  front size = 3.
- Invariant: `full-front-size (3) ≥ reduced-front-size (3)` ✓.
- `mutate` called exactly `K=3` times (vs `1` for single-best reflection).

## Unchanged invariants (inherited)

- `strict-improvement` hard gate (T04) — not touched.
- Held-out gate — `fastNonDominatedSort` raises `SelectionSignalViolation`
  on any non-`train` `split` (contract §2).
- `WeightedSumForbidden` — no weighted-aggregation method on
  `FullParetoSelector`; the `weightedSum` property is deliberately absent.
- Direction pins (`resolve_rate`↑, `cache_hit`↑, `token`↓) replicated
  verbatim from T05 to prevent direction drift.

## V2 deferred

- Crowding distance (`packages/l3-engine/src/pareto/crowding-distance.ts`)
  for diversity selection within a front.
- Standard NSGA-II max-rank peeling (current impl is min-rank / BFS layering
  per spec behavior "rank=1 含被 rank0 支配集").
