// L1-T15 · context mode 路由 + summarized handoff 模板进化（fork/fresh 不变量 static-core）
//
// context 隔离三模式（fresh / fork-inherit / summarized）路由策略 + summarized
// 压缩模板（02-orchestration §2）。进化的对象 = `context_mode_router.yaml`
// （任务特征向量→模式）+ `prompts/summarized-handoff.md`（压缩模板）。
//
// **fork/fresh 不变量 = static-core**（信任域边界）：
// - fresh 不得加载 parent history（fresh = 干净上下文隔离）。
// - fork 必复制**完整** history（partial = 隔离泄漏）。
// 两个 `assert*` 守卫在 commit/canary 前跑，违反 → throw，回滚 + 安全告警
// （02-orchestration §2(f)）。
//
// 信号 = token budget 内 acceptance（acceptanceInBudget↑）+ 重做率
// （redoRate↓，child 重复 parent 已完成探查）。strict-improvement 门：
// 任一退化 ≥ τ → reject 候选 router/template（复用 L3-T04 strict-improvement 思路）。
//
// 复用 vs 自研：
// - L3-T04 strict-improvement 复用：本任务以 `ContextModeScore`
//   （acceptanceInBudget↑ ∧ redoRate↓）实现专属 strict-improvement 门。
// - 自研：`context-mode-router.ts`（路由查表 + 模板进化 + 不变量守卫）。
//
// summarized 模板字段须保留「未决 bug / 架构决策 / modified-files」
// （pi CompactionEntry 字段对齐，spec §L1-T15 执行提示(2)）。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConfigRepo } from "./repo-layout.js";

// ── 公共类型 ───────────────────────────────────────────────────────────────

export type ContextMode = "fresh" | "fork" | "summarized";

export interface ContextModeRule {
  readonly features: Record<string, unknown>;
  readonly mode: ContextMode;
}

export interface ContextModeScore {
  /** token budget 内达成 acceptance（越高越好）。 */
  readonly acceptanceInBudget: number;
  /** 重做率：child 重复 parent 已完成探查（越低越好）。 */
  readonly redoRate: number;
  /** 是否为基线（active 当前版本）。 */
  readonly isBaseline: boolean;
}

// ── 错误类型 ───────────────────────────────────────────────────────────────

/**
 * fresh 模式加载 parent history 违反隔离不变量（static-core）。
 * fresh = 干净上下文隔离，不得继承 parent history；违反 → throw + 回滚。
 */
export class FreshParentHistoryError extends Error {
  constructor(message?: string) {
    super(message ?? "fresh context mode must not load parent history (isolation invariant)");
    this.name = "FreshParentHistoryError";
  }
}

/**
 * fork 模式复制 partial history 违反隔离不变量（static-core）。
 * fork 必复制**完整** history；partial = 隔离泄漏 → throw + 回滚。
 */
export class ForkPartialHistoryError extends Error {
  constructor(message?: string) {
    super(message ?? "fork context mode must copy full history (isolation invariant)");
    this.name = "ForkPartialHistoryError";
  }
}

// ── 常量 ───────────────────────────────────────────────────────────────────

/** strict-improvement 退化阈值 τ（任一退化 ≥ τ → reject 候选）。 */
const DEFAULT_STRICT_TAU = 0.02;

/** summarized 模板须保留的 static-core 字段（pi CompactionEntry 对齐）。 */
const SUMMARIZED_REQUIRED_FIELDS = ["未决 bug", "架构决策", "modified-files"] as const;

/** summarized handoff active 路径（相对 repo root）。 */
const SUMMARIZED_HANDOFF_PATH = "prompts/summarized-handoff.md";

/**
 * 默认 router 规则表（active 基线）。
 *
 * - 评审类任务（code-review / review）→ fresh（独立干净上下文，避免 parent 偏见）。
 * - 需 parent 背景的探查类 → fork（完整继承 history）。
 * - 长上下文压缩场景 → summarized。
 * - 兜底 → fresh（最保守隔离）。
 */
const DEFAULT_RULES: readonly ContextModeRule[] = [
  { features: { taskType: "code-review" }, mode: "fresh" },
  { features: { taskType: "review" }, mode: "fresh" },
  { features: { needsParentBackground: true }, mode: "fork" },
  { features: { taskType: "research", longRunning: true }, mode: "summarized" },
];

// ── 纯函数：特征匹配 ───────────────────────────────────────────────────────

/**
 * 规则特征匹配：rule.features 的每个键值对都须在 task features 中相等出现
 * （子集匹配，空 features 视为通配兜底）。
 */
function featuresMatch(
  ruleFeatures: Record<string, unknown>,
  taskFeatures: Record<string, unknown>,
): boolean {
  const keys = Object.keys(ruleFeatures);
  if (keys.length === 0) return true; // 兜底通配
  for (const key of keys) {
    const rv = ruleFeatures[key];
    const tv = taskFeatures[key];
    // 数组/对象用 JSON 比较，原始值用 ===
    if (typeof rv === "object" && rv !== null) {
      if (JSON.stringify(rv) !== JSON.stringify(tv)) return false;
    } else if (rv !== tv) {
      return false;
    }
  }
  return true;
}

// ── 纯函数：strict-improvement 门 ──────────────────────────────────────────

/**
 * strict-improvement 硬门：acceptanceInBudget↑ ∧ redoRate↓，任一退化 ≥ τ → false。
 *
 * - acceptanceInBudget：越高越好；candidate < baseline 为退化
 *   （baseline - cand >= τ → reject）。
 * - redoRate：越低越好；candidate > baseline 为退化
 *   （cand - baseline >= τ → reject）。
 *
 * 纯函数无 IO，便于 canary 对抗场景复用（与 T04b strictImprovementGate 同构）。
 */
export function contextModeStrictImprovementGate(
  cand: ContextModeScore,
  baseline: ContextModeScore,
  tau: number,
): boolean {
  // acceptanceInBudget 越高越好：candidate < baseline 为退化
  if (baseline.acceptanceInBudget - cand.acceptanceInBudget >= tau) return false;
  // redoRate 越低越好：candidate > baseline 为退化
  if (cand.redoRate - baseline.redoRate >= tau) return false;
  return true;
}

// ── 纯函数：summarized 模板字段守卫 ─────────────────────────────────────────

/**
 * summarized 模板须保留 static-core 字段（「未决 bug / 架构决策 / modified-files」）。
 * 候选模板缺任一 → throw（隔离不变量 + pi CompactionEntry 对齐）。
 */
export function assertSummarizedFieldsIntact(template: string): void {
  for (const field of SUMMARIZED_REQUIRED_FIELDS) {
    if (!template.includes(field)) {
      throw new Error(
        `summarized handoff template missing required static-core field: ${field}`,
      );
    }
  }
}

// ── ContextModeRouter ──────────────────────────────────────────────────────

export interface ContextModeRouterOptions {
  /** L1 ConfigRepo（加载 summarized handoff active 模板用）。 */
  readonly repo?: ConfigRepo;
  /** 注入式 router 规则表（缺省用 DEFAULT_RULES）。 */
  readonly rules?: readonly ContextModeRule[];
  /** strict-improvement 退化阈值 τ（缺省 DEFAULT_STRICT_TAU）。 */
  readonly tau?: number;
}

/**
 * context mode 路由 + summarized handoff 模板进化 + fork/fresh 不变量守卫。
 *
 * - `route(features)`：按任务特征向量查表返回模式（评审类→fresh）。
 * - `evolve(router, template, scores)`：候选 strict-improvement 门 +
 *   模板字段锁 → 返回 evolved `{ router, template }`。
 * - `assertFreshNoParentHistory` / `assertForkFullHistory`：static-core
 *   隔离不变量守卫，commit/canary 前跑，违反 → throw + 回滚。
 */
export class ContextModeRouter {
  private readonly repo: ConfigRepo | undefined;
  private readonly rules: readonly ContextModeRule[];
  private readonly tau: number;

  constructor(opts: ContextModeRouterOptions) {
    this.repo = opts.repo;
    this.rules = opts.rules ?? DEFAULT_RULES;
    this.tau = opts.tau ?? DEFAULT_STRICT_TAU;
  }

  /**
   * 加载 summarized handoff active 模板（prompts/summarized-handoff.md）。
   * repo 优先于构造注入。
   */
  loadSummarizedTemplate(repo?: ConfigRepo): string {
    const r = repo ?? this.repo;
    if (!r) {
      throw new Error("ContextModeRouter.loadSummarizedTemplate requires a ConfigRepo");
    }
    // 复用 ConfigRepo.getRoot() 读 active 文件（sha 钉死由 ConfigRepo 保证）
    const root = r.getRoot();
    return readFileSync(join(root, SUMMARIZED_HANDOFF_PATH), "utf8");
  }

  /**
   * 按任务特征向量查表返回 context mode。
   *
   * 顺序匹配注入规则（或 DEFAULT_RULES）；首个匹配规则的模式胜出。
   * 无匹配 → fresh（最保守隔离，信任域边界）。
   *
   * spec 行为规范：评审类任务 → fresh。
   */
  route(features: Record<string, unknown>): ContextMode {
    for (const rule of this.rules) {
      if (featuresMatch(rule.features, features)) {
        return rule.mode;
      }
    }
    return "fresh"; // 兜底：最保守隔离
  }

  /**
   * strict-improvement 硬门：acceptanceInBudget↑ ∧ redoRate↓，任一退化 ≥ τ → false。
   *
   * 纯函数无 IO，便于 canary 对抗场景复用（与 T04b/T14 strictImprovementGate 同构）。
   */
  strictImprovementGate(
    cand: ContextModeScore,
    baseline: ContextModeScore,
    tau: number = this.tau,
  ): boolean {
    return contextModeStrictImprovementGate(cand, baseline, tau);
  }

  /**
   * 进化 context mode 基质：候选 router/template 经 strict-improvement 门 +
   * summarized 字段锁 → 返回 evolved `{ router, template }`。
   *
   * - 候选 scores 中 isBaseline=true 为基线，其余为候选；候选须在
   *   acceptanceInBudget↑ ∧ redoRate↓ 双改善（strict-improvement）才入选。
   * - summarized 模式候选 template 须保留 static-core 字段
   *   （`assertSummarizedFieldsIntact`），缺字段 → throw。
   * - 改善方向反映到 evolved template（如 redoRate↓ → 允许加字段，长度不缩）。
   *
   * 退化或无候选 → 原样回传（不入选，需人审/canary）。
   */
  evolve(
    router: readonly ContextModeRule[],
    template: string,
    scores: readonly ContextModeScore[],
  ): { router: readonly ContextModeRule[]; template: string } {
    const baseline = scores.find((s) => s.isBaseline) ?? scores[0];
    if (!baseline) {
      return { router, template };
    }
    const candidates = scores.filter((s) => !s.isBaseline);
    if (candidates.length === 0) {
      return { router, template };
    }

    // 任一候选 strict-improvement 通过即入选（取首个改善候选）
    let bestCand: ContextModeScore | undefined;
    for (const cand of candidates) {
      if (this.strictImprovementGate(cand, baseline)) {
        bestCand = cand;
        break;
      }
    }
    if (!bestCand) {
      // 无改善候选 → 原样回传（退化候选 reject）
      return { router, template };
    }

    // 模板进化：redoRate↓ 允许加字段（反映改善方向），长度不缩。
    // static-core 字段须保留（assertSummarizedFieldsIntact）。
    let evolvedTemplate = template;
    if (bestCand.redoRate < baseline.redoRate) {
      // 加一个「探查去重」字段提示（summarized 模板进化允许加字段，spec 边界）
      const fieldMarker = "\n## 探查去重\n<parent-done-probes>\n";
      if (!evolvedTemplate.includes("探查去重")) {
        evolvedTemplate = evolvedTemplate + fieldMarker;
      }
    }
    // summarized 模式候选须保留 static-core 字段
    const hasSummarized = router.some((r) => r.mode === "summarized");
    if (hasSummarized) {
      assertSummarizedFieldsIntact(evolvedTemplate);
    }

    return { router, template: evolvedTemplate };
  }

  /**
   * fresh 不变量守卫（static-core）：fresh 模式不得加载 parent history。
   *
   * fresh = 干净上下文隔离；fresh + loadedParentHistory=true → throw
   * `FreshParentHistoryError`（隔离不变量违反，回滚 + 安全告警）。
   * fork/summarized 加载 parent history 是允许的（fork 必须继承，summarized 压缩继承）。
   */
  assertFreshNoParentHistory(
    mode: ContextMode,
    loadedParentHistory: boolean,
  ): void {
    if (mode === "fresh" && loadedParentHistory) {
      throw new FreshParentHistoryError();
    }
  }

  /**
   * fork 不变量守卫（static-core）：fork 模式必须复制**完整** history。
   *
   * fork + copiedHistory='partial' → throw `ForkPartialHistoryError`
   * （隔离泄漏，回滚 + 安全告警）。fork + 'full' 通过。
   * fresh/summarized 不受此守卫约束（fresh 不复制，summarized 压缩）。
   */
  assertForkFullHistory(
    mode: ContextMode,
    copiedHistory: "full" | "partial",
  ): void {
    if (mode === "fork" && copiedHistory === "partial") {
      throw new ForkPartialHistoryError();
    }
  }
}
