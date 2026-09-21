// L3-T11: Bayesian surrogate — mini-batch random-forest regressor that
// proxies expensive canary evaluations during DSPy/MIPROv2 instruction×demo
// search.
//
// Spec: execution/L3-engine/TASKS.md §L3-T11.
//
// Design (MVP, V1):
//  - Surrogate = lightweight random-forest regression-tree ensemble (pure JS,
//    no numpy-grade deps). GP is deferred to V2 (REFACTOR: surrogate/gp.ts).
//  - `fit` accepts ONLY `split === 'train'` samples; heldout/val samples must
//    never feed the surrogate (PRD §6.7 train/val anti-overfit gate) — feeding
//    a heldout sample raises `TrainValLeak` (the leak guard is the RED
//    contract).
//  - `predict` returns `{ mean, variance }`: mean = ensemble leaf-mean
//    average; variance = epistemic (disagreement across trees) + a GP-style
//    distance-to-data term that grows away from the training cloud (high for
//    unseen mutants, ~0 for known ones).
//  - `acquisition` = UCB: `mean + κ·√variance` — high mean OR high variance
//    candidates are prioritised (exploration/exploitation balance).

import type { Mutant, Fitness } from "../types.js";
import { mulberry32, hashStr } from "../prng.js";

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

/**
 * Raised when `fit` receives a sample whose `split !== 'train'` (e.g. a
 * heldout/val sample). Heldout samples must NEVER feed the surrogate —
 * doing so leaks the validation set into the optimiser and defeats the
 * train/val anti-overfit gate (PRD §6.7, §L3-T11 contract §2).
 */
export class TrainValLeak extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrainValLeak";
  }
}

// ---------------------------------------------------------------------------
// Surrogate sample shape (contract).
// ---------------------------------------------------------------------------

export interface SurrogateSample {
  mutant: Mutant;
  fitness: Fitness;
  /** Only `'train'` is accepted; anything else raises `TrainValLeak`. */
  split: "train";
}

export interface SurrogatePrediction {
  mean: number;
  variance: number;
}

export interface BayesianSurrogateOptions {
  seed: number;
  /** Number of regression trees in the ensemble. */
  trees?: number;
  /** Max tree depth. */
  maxDepth?: number;
  /** UCB exploration coefficient κ. */
  kappa?: number;
  /** Feature-hash bucket count. */
  features?: number;
}

// ---------------------------------------------------------------------------
// Feature extraction — hashed bag-of-tokens.
//
// `content` is tokenised on non-alphanumeric boundaries; each token is
// hashed (FNV-1a via `hashStr`) into one of `K` buckets and the bucket is
// incremented. This gives a fixed-length numeric feature vector per mutant,
// stable across samples so identical content → identical vector (which is
// what makes the distance-to-data term collapse to 0 for known samples).
// ---------------------------------------------------------------------------

function featurize(content: string, k: number): Float64Array {
  const v = new Float64Array(k);
  const tokens = content.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
  for (const t of tokens) {
    const b = hashStr(t) % k;
    v[b] = (v[b] ?? 0) + 1;
  }
  // Also fold the raw content hash in so single-token mutants remain
  // distinguishable per-instance (a leaf isolating a unique sample is the
  // memorisation mechanism behind the Pearson > 0.5 RED).
  const cb = hashStr(content) % k;
  v[cb] = (v[cb] ?? 0) + 1;
  return v;
}

// ---------------------------------------------------------------------------
// Regression tree (CART-style variance-reduction splits).
// ---------------------------------------------------------------------------

interface TreeNode {
  leaf: boolean;
  // leaf fields
  mean: number;
  // variance of training fitness falling into this leaf (aleatoric
  // uncertainty; 0 for a pure single-sample leaf).
  var: number;
  // internal fields
  feat?: number;
  thr?: number;
  left?: TreeNode;
  right?: TreeNode;
}

interface TrainingRow {
  x: Float64Array;
  y: number;
}

function buildTree(
  rows: TrainingRow[],
  depth: number,
  maxDepth: number,
  rng: () => number,
  featDim: number,
): TreeNode {
  const n = rows.length;
  const mean = n === 0 ? 0 : rows.reduce((s, r) => s + r.y, 0) / n;
  const varr =
    n <= 1
      ? 0
      : rows.reduce((s, r) => s + (r.y - mean) ** 2, 0) / n;

  // Stop: empty / pure / depth exhausted.
  if (n <= 1 || varr === 0 || depth >= maxDepth) {
    return { leaf: true, mean, var: varr };
  }

  // Candidate splits: for each feature, scan midpoints of sorted unique
  // values. Pick the split maximising weighted variance reduction. Ties
  // broken by rng so the ensemble diversifies (random tie-break is the
  // only source of tree diversity besides bootstrap).
  let bestGain = -Infinity;
  let bestFeat = -1;
  let bestThr = 0;
  let bestLeft: TrainingRow[] | null = null;
  let bestRight: TrainingRow[] | null = null;

  for (let f = 0; f < featDim; f++) {
    const vals = rows.map((r) => r.x[f]);
    const uniq = Array.from(new Set(vals)).sort((a, b) => (a ?? 0) - (b ?? 0));
    for (let i = 0; i < uniq.length - 1; i++) {
      const thr = ((uniq[i] ?? 0) + (uniq[i + 1] ?? 0)) / 2;
      const left: TrainingRow[] = [];
      const right: TrainingRow[] = [];
      for (const r of rows) {
        if ((r.x[f] ?? 0) <= thr) left.push(r);
        else right.push(r);
      }
      if (left.length === 0 || right.length === 0) continue;
      const lm = left.reduce((s, r) => s + r.y, 0) / left.length;
      const rm = right.reduce((s, r) => s + r.y, 0) / right.length;
      const lv =
        left.reduce((s, r) => s + (r.y - lm) ** 2, 0) / left.length;
      const rv =
        right.reduce((s, r) => s + (r.y - rm) ** 2, 0) / right.length;
      const childVar =
        (left.length * lv + right.length * rv) / n;
      const gain = varr - childVar;
      // Random tie-break: small rng jitter so equally-good splits across
      // trees differ → ensemble disagreement (epistemic uncertainty).
      const score = gain + rng() * 1e-9;
      if (score > bestGain) {
        bestGain = score;
        bestFeat = f;
        bestThr = thr;
        bestLeft = left;
        bestRight = right;
      }
    }
  }

  if (bestLeft === null || bestRight === null || bestFeat < 0) {
    return { leaf: true, mean, var: varr };
  }

  const node: TreeNode = {
    leaf: false,
    mean,
    var: varr,
    feat: bestFeat,
    thr: bestThr,
  };
  node.left = buildTree(bestLeft, depth + 1, maxDepth, rng, featDim);
  node.right = buildTree(bestRight, depth + 1, maxDepth, rng, featDim);
  return node;
}

function routeTree(node: TreeNode, x: Float64Array): { mean: number; var: number } {
  let cur = node;
  while (!cur.leaf) {
    if ((x[cur.feat!] ?? 0) <= (cur.thr ?? 0)) cur = cur.left!;
    else cur = cur.right!;
  }
  return { mean: cur.mean, var: cur.var };
}

// ---------------------------------------------------------------------------
// BayesianSurrogate (random-forest ensemble).
// ---------------------------------------------------------------------------

export class BayesianSurrogate {
  private readonly seed: number;
  private readonly trees: number;
  private readonly maxDepth: number;
  private readonly kappa: number;
  private readonly featDim: number;
  private roots: TreeNode[] = [];
  private trainRows: TrainingRow[] = [];
  private trainX: Float64Array[] = [];

  constructor(opts: BayesianSurrogateOptions) {
    this.seed = opts.seed >>> 0;
    this.trees = opts.trees ?? 16;
    this.maxDepth = opts.maxDepth ?? 6;
    this.kappa = opts.kappa ?? 1.0;
    this.featDim = opts.features ?? 64;
  }

  /**
   * Fit the ensemble on `samples`. Every sample MUST carry `split === 'train'`;
   * any other value raises `TrainValLeak` (heldout leak guard, contract §2).
   */
  fit(samples: SurrogateSample[]): void {
    for (const s of samples) {
      if (s.split !== "train") {
        throw new TrainValLeak(
          `L3-T11: surrogate.fit received non-train split ('${String(
            (s as { split: string }).split,
          )}') — heldout/val samples must never feed the surrogate (train/val anti-overfit gate)`,
        );
      }
    }

    // Fitness signal = resolve_rate (the GEPA primary key; multi-objective
    // selection stays the Pareto selector's job — the surrogate only needs a
    // scalar response for the regression).
    this.trainRows = samples.map((s) => ({
      x: featurize(s.mutant.content, this.featDim),
      y: s.fitness.resolve_rate,
    }));
    this.trainX = this.trainRows.map((r) => r.x);

    this.roots = [];
    const baseRng = mulberry32(this.seed);
    for (let t = 0; t < this.trees; t++) {
      // Per-tree PRNG seed (deterministic, distinct per tree).
      const rng = mulberry32((this.seed ^ (t * 0x9e3779b1)) >>> 0);
      // Bootstrap sample (with replacement) for epistemic diversity.
      const boot: TrainingRow[] = [];
      const n = this.trainRows.length;
      for (let i = 0; i < n; i++) {
        boot.push(this.trainRows[Math.floor(baseRng() * n)]!);
      }
      this.roots.push(buildTree(boot, 0, this.maxDepth, rng, this.featDim));
    }
  }

  /**
   * Predict `{ mean, variance }` for a mutant.
   *
   *  - mean = average leaf-mean across trees.
   *  - variance = epistemic (variance of per-tree leaf means) + a GP-style
   *    distance-to-data term that is ~0 for known samples (exact feature match
   *    → distance 0) and grows toward 1 for unseen mutants.
   */
  predict(mutant: Mutant): SurrogatePrediction {
    if (this.roots.length === 0) {
      return { mean: 0, variance: 1 };
    }
    const x = featurize(mutant.content, this.featDim);

    const leafMeans: number[] = [];
    let sum = 0;
    for (const root of this.roots) {
      const { mean } = routeTree(root, x);
      leafMeans.push(mean);
      sum += mean;
    }
    const mean = sum / this.roots.length;

    // Epistemic uncertainty: disagreement across trees.
    let epistemic = 0;
    for (const m of leafMeans) epistemic += (m - mean) ** 2;
    epistemic /= this.roots.length;

    // Distance-to-data term (GP analogue): normalised minimum Euclidean
    // distance to any training feature vector. Exact-match → 0; far novel →
    // approaches 1.
    let minDist = Infinity;
    for (const tx of this.trainX) {
      let d = 0;
      for (let i = 0; i < this.featDim; i++) {
        const diff = (x[i] ?? 0) - (tx[i] ?? 0);
        d += diff * diff;
        // Early-exit if already worse than current min.
        if (d >= minDist) break;
      }
      if (d < minDist) minDist = d;
    }
    if (!isFinite(minDist)) minDist = 1;
    const novelty = minDist / (1 + minDist);

    const variance = epistemic + novelty;
    return { mean, variance };
  }

  /**
   * UCB acquisition: `mean + κ·√variance`. High-mean candidates are
   * exploited; high-variance (novel, tree-disagreed) candidates are
   * explored — the exploration/exploitation balance (§L3-T11 boundary).
   */
  acquisition(mutant: Mutant): number {
    const { mean, variance } = this.predict(mutant);
    return mean + this.kappa * Math.sqrt(Math.max(0, variance));
  }
}
