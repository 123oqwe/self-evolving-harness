// L1-T04b · compaction 进化 loop-b：strict-improvement 门 + Pareto select +
// commit-on-success retain
//
// Spec: execution/L1-config/TASKS.md §L1-T04b。
//
// 进化闭环第二半——打分、选择、保留（PRD §8.1 交付物 #5；02-loop-context
// §1.4b(d-f)）。
//
// - strict-improvement 硬门：held-out 任一指标退化 ≥ τ → reject（PRD §6.7 /
//   L3-T04）。三指标：recall（越低越好）、resolveRate（越高越好）、cacheHit
//   （越高越好），各判退化，无加权求和。
// - Pareto 多目标：recall ∧ resolve ∧ cache 非支配排序，无加权求和
//   （PRD §6.7 / L3-T05）。`paretoFront` 入参声明为 `unknown[]`：运行时逐元素
//   形状校验——必须是完整 `CandidateScore` 形状（recall/resolveRate/cacheHit/
//   isBaseline 缺一不可），且不得含 `score` 单值字段（视加权求和 → throw
//   `NoWeightedSumError`）。`unknown[]` 正是为让该运行时 guard 可通过类型系统
//   触发（若放宽为 `CandidateScore[]`，`{score:0.7}` 在编译期被拒，guard 无从
//   触发）。
// - commit-on-success：候选过门才写 active + 版本后缀（Voyager，PRD §7.3）。
//   版本后缀（v2/v3…）是回滚的物理基础（PRD §6.4 keep-all variant），绝不
//   直接覆盖 active 而不留版本后缀。
//
// REFACTOR：strict-improvement 门与 Pareto 前沿均为纯函数（无 IO），便于
// T05b 与 L3-T04/T05 复用。

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { ConfigRepo } from "./repo-layout.js";
import type { VariantCandidate } from "./substrate-types.js";
import { rollbackStore } from "./canary-config-plane.js";

// ── 公共类型 ───────────────────────────────────────────────────────────────

/**
 * 候选打分（held-out 评测产出）。三指标无加权——strict-improvement 与 Pareto
 * 各自独立判断，不得求和（PRD §6.7）。
 *
 * - recall：重读次数，越低越好（recall 退化 = 重读↑）。
 * - resolveRate：held-out resolve_rate，越高越好。
 * - cacheHit：cache 命中率，越高越好。
 * - isBaseline：标记基线分数（select 时作参照，不进候选前沿）。
 */
export interface CandidateScore {
  readonly candidateId: string;
  readonly recall: number;
  readonly resolveRate: number;
  readonly cacheHit: number;
  readonly isBaseline: boolean;
}

// ── 错误类型 ───────────────────────────────────────────────────────────────

/**
 * 加权求和路径被检测到（含 `score` 单值字段，或元素非完整 `CandidateScore`
 * 形状）。PRD §6.7 禁加权求和——多目标须独立 Pareto，不得 scalar 化。
 */
export class NoWeightedSumError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoWeightedSumError";
  }
}

/**
 * retain 退化门拒绝（fail-closed）。候选在 strict-improvement 硬门或 Pareto
 * 前沿上失败 → `commitOnSuccess` 抛此错并**不触盘**（不写 active / staging /
 * pinSha）。对照 L3 `Retain.commit(mutant, gate)` 的 `if (!gate...) return null`
 * fail-closed 守卫——L1 侧以 throw 形式落地（commitOnSuccess 返回 void）。
 */
export class RetainGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetainGateError";
  }
}

/** strict-improvement 门默认退化容忍阈值 τ（PRD §6.7；与 T04b/T05b spec 一致）。 */
const DEFAULT_STRICT_TAU = 0.02;

// ── 纯函数：strict-improvement 门 + Pareto 前沿 ─────────────────────────────

/**
 * strict-improvement 硬门：held-out 任一指标退化 ≥ τ → false（reject）。
 *
 * 退化量按各指标方向计算（recall 越低越好 → candidate 高于 baseline 为退化；
 * resolveRate/cacheHit 越高越好 → candidate 低于 baseline 为退化）。任一退化
 * ≥ τ 即 reject；持平或改善不算退化。
 *
 * 纯函数无 IO，便于 T05b / L3-T04 复用。
 */
export function strictImprovementGate(
  score: CandidateScore,
  baseline: CandidateScore,
  tau: number,
): boolean {
  const degradations: ReadonlyArray<{ key: "recall" | "resolveRate" | "cacheHit"; delta: number }> = [
    { key: "recall", delta: score.recall - baseline.recall }, // 越低越好：candidate>baseline = 退化
    { key: "resolveRate", delta: baseline.resolveRate - score.resolveRate }, // 越高越好：candidate<baseline = 退化
    { key: "cacheHit", delta: baseline.cacheHit - score.cacheHit }, // 越高越好：candidate<baseline = 退化
  ];
  for (const d of degradations) {
    if (d.delta >= tau) {
      return false; // 任一退化 ≥ τ → reject
    }
  }
  return true;
}

/**
 * 运行时形状校验：元素必须是完整 `CandidateScore` 形状（对象 + recall/
 * resolveRate/cacheHit 为 number + isBaseline 为 boolean），且不得含 `score`
 * 单值字段（加权求和路径）。失配 → throw `NoWeightedSumError`。
 */
function assertCandidateScoreShape(el: unknown, index: number): asserts el is CandidateScore {
  if (el === null || typeof el !== "object" || Array.isArray(el)) {
    throw new NoWeightedSumError(
      `candidate[${index}] is not a CandidateScore object (got ${el === null ? "null" : Array.isArray(el) ? "array" : typeof el})`,
    );
  }
  const obj = el as Record<string, unknown>;
  // 含 `score` 单值字段 → 视加权求和路径 → throw（PRD §6.7 禁加权求和）
  if ("score" in obj) {
    throw new NoWeightedSumError(
      `candidate[${index}] carries a 'score' single-value field — weighted-sum path is forbidden (PRD §6.7)`,
    );
  }
  const required: ReadonlyArray<"recall" | "resolveRate" | "cacheHit" | "isBaseline"> = [
    "recall",
    "resolveRate",
    "cacheHit",
    "isBaseline",
  ];
  for (const k of required) {
    if (!(k in obj)) {
      throw new NoWeightedSumError(
        `candidate[${index}] missing required field '${k}' (not a full CandidateScore shape)`,
      );
    }
  }
  if (typeof obj.recall !== "number" || typeof obj.resolveRate !== "number" || typeof obj.cacheHit !== "number" || typeof obj.isBaseline !== "boolean") {
    throw new NoWeightedSumError(
      `candidate[${index}] has wrong-typed field(s) — expected recall/resolveRate/cacheHit:number, isBaseline:boolean`,
    );
  }
}

/**
 * A 是否支配 B（A 在三指标上均不劣于 B 且至少一项严格更优）。
 * recall 越低越好；resolveRate/cacheHit 越高越好。
 */
function dominates(a: CandidateScore, b: CandidateScore): boolean {
  const recallLe = a.recall <= b.recall;
  const resolveGe = a.resolveRate >= b.resolveRate;
  const cacheGe = a.cacheHit >= b.cacheHit;
  const atLeastOneStrict =
    a.recall < b.recall ||
    a.resolveRate > b.resolveRate ||
    a.cacheHit > b.cacheHit;
  return recallLe && resolveGe && cacheGe && atLeastOneStrict;
}

// ── SelectRetain ────────────────────────────────────────────────────────────

/**
 * SelectRetain 构造 opts。`repo`：ConfigRepo（commit-on-success 写 active +
 * staging + pinSha）。ERRATA-w2plus 风格：opts 结构化注入。
 */
export interface SelectRetainOptions {
  readonly repo: ConfigRepo;
}

const COMPACTION_ACTIVE = "prompts/compaction-summary.md";
const COMPACTION_STAGING_DIR = "staging";

/**
 * compaction 进化 loop-b：strict-improvement 门 + Pareto select + commit-on-success
 * retain。
 *
 * `strictImprovementGate` / `paretoFront` 为纯函数无 IO；`commitOnSuccess` 触盘
 * （写 active + staging 版本后缀 + 调 `ConfigRepo.pinSha`）。
 */
export class SelectRetain {
  private readonly repo: ConfigRepo;

  constructor(opts: SelectRetainOptions) {
    this.repo = opts.repo;
  }

  /** strict-improvement 硬门（纯函数委托）。 */
  strictImprovementGate(
    score: CandidateScore,
    baseline: CandidateScore,
    tau: number,
  ): boolean {
    return strictImprovementGate(score, baseline, tau);
  }

  /**
   * fail-closed 退化门裁决（commitOnSuccess 前置）。从 `scores` 抽取基线
   * （`isBaseline===true`）与候选分数集，对每个候选强制跑 `strictImprovementGate`
   * + `paretoFront`：任一退化 ≥ τ 或被帕累托支配 → 抛 `RetainGateError`（不触盘）。
   * 仅基线无候选分数时不裁决（向后兼容；生产须串 select）。
   */
  private enforceGate(scores: CandidateScore[], tau: number): void {
    const baseline = scores.find((s) => s.isBaseline);
    if (!baseline) return; // 无基线参照 → 无法裁决退化，交由调用方契约
    const candidates = scores.filter((s) => !s.isBaseline);
    for (const c of candidates) {
      if (!strictImprovementGate(c, baseline, tau)) {
        throw new RetainGateError(
          `commitOnSuccess rejected: candidate '${c.candidateId}' failed strict-improvement gate ` +
            `(recall/resolveRate/cacheHit 退化 ≥ τ=${tau}; PRD §6.7) — fail-closed, no active/staging write`,
        );
      }
    }
    if (candidates.length === 0) return;
    const front = this.paretoFront(candidates, baseline);
    const frontIds = new Set(front.map((f) => f.candidateId));
    for (const c of candidates) {
      if (!frontIds.has(c.candidateId)) {
        throw new RetainGateError(
          `commitOnSuccess rejected: candidate '${c.candidateId}' is Pareto-dominated ` +
            `(PRD §6.7) — fail-closed, no active/staging write`,
        );
      }
    }
  }

  /**
   * Pareto 非支配前沿。入参声明 `unknown[]`：运行时逐元素形状校验，非完整
   * `CandidateScore` 形状或含 `score` 单值字段 → throw `NoWeightedSumError`
   * （禁加权求和路径）。`baseline` 作参照但不进前沿输出。
   */
  paretoFront(candidates: unknown[], baseline: CandidateScore): CandidateScore[] {
    const typed: CandidateScore[] = candidates.map((el, i) => {
      assertCandidateScoreShape(el, i);
      return el;
    });
    void baseline; // 参照点（保留入参语义）；前沿仅由 candidates 非支配集决定
    const front: CandidateScore[] = [];
    for (let i = 0; i < typed.length; i++) {
      const a = typed[i]!;
      let dominated = false;
      for (let j = 0; j < typed.length; j++) {
        if (i === j) continue;
        const b = typed[j]!;
        if (dominates(b, a)) {
          dominated = true;
          break;
        }
      }
      if (!dominated) front.push(a);
    }
    return front;
  }

  /**
   * commit-on-success：候选**过门**才写 active（`prompts/compaction-summary.md`，
   * 内容更新）+ staging 版本后缀（`staging/compaction-summary.v{N}.md`，可回滚）+
   * 调 `ConfigRepo.pinSha` 重锁。写 active 前把基线内容存入 `rollbackStore`，
   * 供 `CanaryConfigPlane.rollback` 恢复（退化信号 → 回滚 active sha 复原）。
   *
   * 版本后缀是回滚的物理基础（PRD §6.4 keep-all variant）——绝不直接覆盖
   * active 而不留版本后缀。
   *
   * **fail-closed 守卫**（对照 L3 `Retain.commit(mutant, gate)` 内部
   * `if (!gate.strictImprovement || !gate.paretoFront) return null`）：方法名
   * `commitOnSuccess` 语义即「过门才 commit」——此处**强制**对传入 `scores` 跑
   * `strictImprovementGate`（任一指标退化 ≥ τ → 抛 `RetainGateError`，不触盘）
   * 与 `paretoFront`（候选被支配 → 抛 `RetainGateError`）。门裁决**不再**交由调用方
   * 手动前置；退化 candidate 经此路径不会写 active / pinSha 重锁。
   *
   * `scores` 入参须含且仅含一个 `isBaseline===true` 基线分数 + ≥0 个候选分数。
   * 若调用方未注入任何候选分数（仅基线），则无可裁决退化——此路径保留向后兼容
   * （rollback 演练用例的 setup），但生产 driver 须先 `select` 再 `commitOnSuccess`
   * 串接（见 L1-T04b driver），不得绕过 select 直 commit。
   */
  commitOnSuccess(
    candidate: VariantCandidate,
    scores: CandidateScore[],
    tau: number = DEFAULT_STRICT_TAU,
  ): void {
    this.enforceGate(scores, tau);
    const root = this.repo.getRoot();
    const activeAbs = join(root, COMPACTION_ACTIVE);

    // 写 active 前存基线快照（供 rollback 恢复 → active sha 回到回滚前 HEAD）
    if (existsSync(activeAbs)) {
      const baselineContent = readFileSync(activeAbs, "utf8");
      rollbackStore.set(activeAbs, baselineContent);
    }

    // 写 staging 版本后缀（keep-all variant，回滚物理基础）
    const stagingDir = join(root, COMPACTION_STAGING_DIR);
    mkdirSync(stagingDir, { recursive: true });
    const next = nextCompactionVersion(stagingDir);
    const stagingAbs = join(stagingDir, `compaction-summary.v${next}.md`);
    writeFileSync(stagingAbs, candidate.content, "utf8");

    // 写 active（内容更新）
    mkdirSync(join(root, "prompts"), { recursive: true });
    writeFileSync(activeAbs, candidate.content, "utf8");

    // 调 ConfigRepo.pinSha 重锁（spec §L1-T04b GREEN：「调 ConfigRepo.pinSha +
    // 写 staging 版本后缀」）。versionSha 用新内容 sha（生产由 git HEAD 提供，
    // 此处占位以保证单一真值源贯穿——loadActive 反映新内容）。
    const newSha = createHash("sha256").update(candidate.content).digest("hex");
    this.repo.pinSha(newSha);
  }
}

// ── 内部纯函数 ─────────────────────────────────────────────────────────────

/**
 * 扫描 staging 目录现有 `compaction-summary.v{N}.md`，返回下一版本号。
 * 无既有版本 → 2（Voyager 起始约定）；有 → max(N)+1。
 */
function nextCompactionVersion(stagingDir: string): number {
  let max = 1;
  if (existsSync(stagingDir)) {
    for (const name of readdirSync(stagingDir) as string[]) {
      const m = /^compaction-summary\.v(\d+)\.md$/.exec(name);
      if (m) {
        const n = parseInt(m[1]!, 10);
        if (n > max) max = n;
      }
    }
  }
  return max + 1;
}
