// CE-T08: paired McNemar + unresolved-comparison budget 报告器（5-step audit protocol）。
//
// 接口签名严格对齐 execution/canary-eval/TASKS.md §CE-T08 + ERRATA-w2plus CE-19/CE-20：
//   export interface PairedMatrix {
//     baselineSha: string; variantSha: string;
//     scaffoldSha: string;   // §9.3 5-step protocol step 2 pin scaffold sha
//     pairs: { taskId: string; baseline: 0|1; variant: 0|1 }[];  // n≈30
//   }
//   export interface McNemarReport {
//     chi2: number; pValue: number; ci: [number, number];
//     unresolvedBudget: { reported: boolean; requiredMargin: number } | null;
//     groupingSensitivity: number;   // 不同分组下排序稳定性
//     scaffoldSha: string;           // step 2 pin
//     modelScaffoldJoint: boolean;   // step 1
//   }
//   export function runPairedMcNemar(
//     m: PairedMatrix,
//     opts?: { coverage?: number },
//   ): McNemarReport;
//
// ERRATA-w2plus CE-19：`runPairedMcNemar` 双参 `(m, opts?)`；`opts.coverage` 缺省按 0 处理。
// ERRATA-w2plus CE-20：n≈30 用 Yates 连续性校正 χ²；n<25 退化精确二项检验；
//   CI=95% Wilson 区间；测试仅断言 `ci[0]<=ci[1]` 与 `pValue∈[0,1]`。
//
// 行为规范：
//   - n<30 且 coverage<0.9 → `unresolvedBudget.reported=true` + `requiredMargin>0`（R9）。
//   - 配对缺 baseline/variant 字段 → throw `IncompletePairsError`。
//
// 自研：McNemar χ² 计算 + CI + budget 估算 + grouping sensitivity。
// REFACTOR：χ² 计算抽独立纯函数便于突变测试。

/**
 * 配对二值矩阵（baseline vs variant，n≈30）。
 *
 * `scaffoldSha` 由调用方 pin 后透传进 report（§9.3 5-step protocol step 2），
 * `coverage` 不在矩阵字段内，由 ABC 审计推导后经 `runPairedMcNemar` opts 注入。
 */
export interface PairedMatrix {
  baselineSha: string;
  variantSha: string;
  scaffoldSha: string; // §9.3 5-step protocol step 2 pin scaffold sha
  pairs: { taskId: string; baseline: 0 | 1; variant: 0 | 1 }[]; // n≈30
}

/**
 * McNemar 报告（5-step audit protocol）。
 *
 * - `chi2`：McNemar χ²（Yates 连续性校正）；n<25 用精确二项检验时此字段仍给出
 *   校正 χ² 供参考（`pValue` 改由精确二项检验决定）。
 * - `pValue`：双侧 p 值，∈[0,1]。
 * - `ci`：95% Wilson 区间（针对不一致对中 variant 方向比例）。
 * - `unresolvedBudget`：n<30 且 coverage<0.9 时报告的 partial-budget（R9）。
 * - `groupingSensitivity`：不同随机分组下排序稳定性 ∈[0,1]。
 * - `scaffoldSha`：step 2 pin（透传）。
 * - `modelScaffoldJoint`：step 1 — model+scaffold 联合分数（恒 true，由调用方 pin
 *   scaffoldSha 后透传即隐含联合）。
 */
export interface McNemarReport {
  chi2: number;
  pValue: number;
  ci: [number, number];
  unresolvedBudget: { reported: boolean; requiredMargin: number } | null;
  groupingSensitivity: number;
  scaffoldSha: string;
  modelScaffoldJoint: boolean;
}

/**
 * 配对矩阵缺 `baseline` 或 `variant` 字段时抛出（错误路径）。
 */
export class IncompletePairsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompletePairsError";
  }
}

/** 95% Wilson 区间 z 分位数（≈1.959964）。 */
const Z_95 = 1.959964;

/** 覆盖率缺省值（ERRATA-w2plus CE-19：缺省按 0 处理）。 */
const DEFAULT_COVERAGE = 0;

/** ≥30 任务门（PRD §8.1 canary v0 ≥30 任务）。 */
const N_FULL = 30;

/** 覆盖率门（≥90% 覆盖或报 budget）。 */
const COVERAGE_GATE = 0.9;

/** 5pp 噪声地板（与 CE-T08 McNemar n≈30 噪声带对齐，CE-T09 DISCRIMINATION_THRESHOLD 同源）。 */
const NOISE_FLOOR = 0.05;

/**
 * 纯函数：McNemar Yates 连续性校正 χ²。
 *
 * discordant pairs：b = baseline=1 & variant=0；c = baseline=0 & variant=1。
 * χ²_Yates = (|b - c| - 1)² / (b + c)（b+c=0 时返回 0）。
 *
 * 抽独立纯函数便于突变测试（REFACTOR）。
 */
export function mcnemarChi2Yates(b: number, c: number): number {
  const discordant = b + c;
  if (discordant === 0) return 0;
  const diff = Math.abs(b - c) - 1;
  return (diff * diff) / discordant;
}

/**
 * 纯函数：精确二项检验双侧 p 值（n<25 退化路径）。
 *
 * 在 H0 下 b ~ Binomial(b+c, 0.5)，双侧 p = 2 * P(X <= min(b, c))。
 */
export function exactBinomialPValue(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  // 单侧累积：P(X <= k) = sum_{i=0}^{k} C(n, i) * 0.5^n
  let cumulative = 0;
  for (let i = 0; i <= k; i++) {
    cumulative += binomialCoefficient(n, i);
  }
  const oneSided = cumulative * Math.pow(0.5, n);
  const twoSided = Math.min(1, 2 * oneSided);
  return twoSided;
}

/** 纯函数：C(n, k)。 */
function binomialCoefficient(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}

/**
 * 纯函数：χ² → p 值（自由度=1）。
 *
 * 用上尾生存函数 SF = P(X²_1 > x)。通过恒等式 SF(x) = 2 * (1 - Φ(sqrt(x)))
 * = erfc(sqrt(x/2))。此处用互补误差函数的数值逼近（erfc 近似 Abramowitz-Stegun 7.1.26）。
 */
function chiSquare1PValue(chi2: number): number {
  if (chi2 <= 0) return 1;
  const x = Math.sqrt(chi2 / 2);
  return Math.min(1, Math.max(0, erfc(x)));
}

/** erfc 近似（Abramowitz & Stegun 7.1.26），绝对误差 < 1.5e-7。 */
function erfc(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const sign = x >= 0 ? 1 : -1;
  const val = sign >= 0 ? 1 - poly * Math.exp(-x * x) : 1 + poly * Math.exp(-x * x);
  // erfc(x) = 1 - erf(x)
  return 1 - val * sign;
}

/**
 * 纯函数：95% Wilson 区间。
 *
 * 针对比例 p（variant 在不一致对中占 c/(b+c)）。返回 [lower, upper]。
 * n=0 时返回 [0, 0]。
 */
function wilsonInterval(successes: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const p = successes / n;
  const z2 = Z_95 * Z_95;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const halfWidth =
    (Z_95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  const lower = Math.max(0, center - halfWidth);
  const upper = Math.min(1, center + halfWidth);
  return [lower, upper];
}

/**
 * 纯函数：grouping sensitivity（不同随机分组下排序稳定性）。
 *
 * 将 pairs 随机对半切两次（确定性 seeded 洗牌，复用 n 作种子保证可复现），
 * 分别计算每半的 (c-b) 方向符号，与全集方向符号一致的比例 ∈[0,1]。
 * 不一致对 n_disc=0 时稳定性=1（无可比较方向，视作稳定）。
 */
function groupingSensitivity(
  pairs: { baseline: 0 | 1; variant: 0 | 1 }[],
  b: number,
  c: number,
): number {
  const fullSign = Math.sign(c - b);
  if (fullSign === 0) return 1;
  // 确定性 LCG 洗牌（种子 = pairs.length，可复现、无依赖）
  const idx = pairs.map((_, i) => i);
  let seed = pairs.length + 17;
  for (let i = idx.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) % 0x100000000;
    const j = seed % (i + 1);
    const tmpI = idx[i]!;
    const tmpJ = idx[j]!;
    idx[i] = tmpJ;
    idx[j] = tmpI;
  }
  const mid = Math.floor(idx.length / 2);
  let agreements = 0;
  let splits = 0;
  // 两次切分：[0,mid) vs [mid,end)，以及反转
  for (let pass = 0; pass < 2; pass++) {
    const half = pass === 0 ? idx.slice(0, mid) : idx.slice(mid);
    if (half.length === 0) continue;
    let hb = 0;
    let hc = 0;
    for (const i of half) {
      const pr = pairs[i];
      if (!pr) continue;
      if (pr.baseline === 1 && pr.variant === 0) hb++;
      else if (pr.baseline === 0 && pr.variant === 1) hc++;
    }
    const sign = Math.sign(hc - hb);
    if (sign === 0) continue; // 该半无不一致对，跳过
    splits++;
    if (sign === fullSign) agreements++;
  }
  if (splits === 0) return 1;
  return agreements / splits;
}

/**
 * 纯函数：partial-budget required outperformance margin（R9）。
 *
 * McNemar 在 n≈30 时检测 5pp 噪声地板。n<30 时按 95% 零假设 CI 半宽
 * 1.96 * sqrt(0.25 / n) 给出所需超出边际，并与 5pp 地板取大者，保证 >0。
 */
function requiredMarginFor(n: number): number {
  if (n <= 0) return NOISE_FLOOR;
  const halfWidth = Z_95 * Math.sqrt(0.25 / n);
  return Math.max(NOISE_FLOOR, halfWidth);
}

/**
 * 运行 paired McNemar + unresolved-comparison budget 报告（5-step audit protocol）。
 *
 * @param m    配对二值矩阵（baseline vs variant，n≈30）。
 * @param opts `{ coverage?: number }`：覆盖率（0-1，缺省按 0）。
 * @returns `McNemarReport`，含 χ²/pValue/ci + scaffoldSha(pin) +
 *           modelScaffoldJoint + groupingSensitivity + unresolvedBudget。
 * @throws `IncompletePairsError` 当任一 pair 缺 `baseline` 或 `variant` 字段。
 */
export function runPairedMcNemar(
  m: PairedMatrix,
  opts?: { coverage?: number },
): McNemarReport {
  if (!m || !Array.isArray(m.pairs)) {
    throw new IncompletePairsError("PairedMatrix.pairs must be a non-empty array");
  }

  // 错误路径：配对缺 baseline/variant 字段 → throw IncompletePairsError。
  let b = 0; // baseline=1 & variant=0（baseline 好而 variant 坏）
  let c = 0; // baseline=0 & variant=1（variant 好而 baseline 坏）
  for (const pair of m.pairs) {
    if (pair == null || typeof pair !== "object") {
      throw new IncompletePairsError(
        `Pair entry must be an object, got ${String(pair)}`,
      );
    }
    const baseline = (pair as { baseline?: unknown }).baseline;
    const variant = (pair as { variant?: unknown }).variant;
    if (baseline !== 0 && baseline !== 1) {
      throw new IncompletePairsError(
        `Pair "${String((pair as { taskId?: unknown }).taskId)}" missing or invalid baseline field`,
      );
    }
    if (variant !== 0 && variant !== 1) {
      throw new IncompletePairsError(
        `Pair "${String((pair as { taskId?: unknown }).taskId)}" missing or invalid variant field`,
      );
    }
    if (baseline === 1 && variant === 0) b++;
    else if (baseline === 0 && variant === 1) c++;
  }

  const n = m.pairs.length;
  const coverage = opts?.coverage ?? DEFAULT_COVERAGE;

  // χ² 计算（REFACTOR：抽独立纯函数 mcnemarChi2Yates 便于突变测试）。
  const chi2 = mcnemarChi2Yates(b, c);

  // 小样本路径：n<25 退化为精确二项检验（ERRATA-w2plus CE-20）。
  const pValue =
    n < 25
      ? exactBinomialPValue(b, c)
      : chiSquare1PValue(chi2);

  // 95% Wilson 区间（针对 variant 在不一致对中方向比例 c/(b+c)）。
  const ci = wilsonInterval(c, b + c);

  // grouping sensitivity（不同随机分组下排序稳定性）。
  const groupingSens = groupingSensitivity(
    m.pairs.map((p) => ({ baseline: p.baseline, variant: p.variant })),
    b,
    c,
  );

  // unresolved-comparison budget：n<30 且 coverage<0.9 → reported=true + requiredMargin>0（R9）。
  const unresolvedBudget =
    n < N_FULL && coverage < COVERAGE_GATE
      ? {
          reported: true,
          requiredMargin: requiredMarginFor(n),
        }
      : n < N_FULL
        ? { reported: false, requiredMargin: 0 }
        : null;

  return {
    chi2,
    pValue,
    ci,
    unresolvedBudget,
    groupingSensitivity: groupingSens,
    scaffoldSha: m.scaffoldSha, // §9.3 5-step protocol step 2 pin（透传）
    modelScaffoldJoint: true, // step 1：model+scaffold 联合分数
  };
}
