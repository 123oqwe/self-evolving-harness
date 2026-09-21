// L1-T18 · steering policy + 措辞模板进化（checkpoint/REDIRECT/consume-once static-core；KILL/PAUSE 人工 gate）
//
// mid-run steering 的 SteeringPolicy allowlist + 措辞模板（02-orchestration §5）。
// 进化的对象 = `config/steering_policy.yaml`（allowlist：哪些 SteeringCommand 类型
// 对哪类 child 允许 HINT/REDIRECT/PAUSE/KILL）+ `prompts/steering-templates/`
// （HINT/REDIRECT 措辞）。只在 checkpoint 排空 / REDIRECT 须 abort in-flight /
// adoption consume-once = static-core。KILL/PAUSE 权限放宽 = 人工 gate。
//
// 安全门：
// - `assertKillPauseHumanGated`：rule 放宽 KILL/PAUSE 且无人工签 → throw
//   `KillPauseUnsignedError`（KILL/PAUSE = high-risk，类比 reward-tampering ladder，
//   02-orchestration §5(f)；权限放宽不可自主）。
// - `assertCheckpointOnly`：mid-stream / mid-tool 注入 steering → throw
//   `MidStreamInjectionError`（只在 checkpoint 排空是流式确定性不变量，破坏幂等，
//   02-orchestration §5(b)）。
//
// 复用 vs 自研：
// - L3-T04 strict-improvement 复用（adoption↑ ∧ falseReject↓ 硬门）。
// - L1-T11 `HumanGate` 复用方向语义（人审门泛化）。
// - 自研：进化 driver + KILL/PAUSE 人工门 + checkpoint/consume-once 不变量守卫 +
//   steering_policy.yaml commit 入口（同入口强制 KILL/PAUSE 人工 gate）。

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";

// ── 公共类型 ───────────────────────────────────────────────────────────────

/** SteeringCommand 类型（02-orchestration §5）。 */
export type SteeringCommandType = "HINT" | "REDIRECT" | "PAUSE" | "KILL";

/**
 * Steering allowlist 规则：对 `childType` 允许的 command 类型。
 * - `allowed` 含 KILL/PAUSE = 权限放宽状态（须人工 gate 才能进入此态）。
 */
export interface SteeringRule {
  readonly childType: string;
  readonly allowed: readonly SteeringCommandType[];
}

/**
 * Steering policy 进化信号。
 * - `adoptionRate`：child 下一 turn 行为符合 steering 意图（越高越好）。
 * - `falseRejectRate`：policy 误拒率（越低越好）。
 * - `isBaseline`：是否 baseline（当前生效 policy 的信号）。
 */
export interface SteeringScore {
  readonly adoptionRate: number;
  readonly falseRejectRate: number;
  readonly isBaseline: boolean;
}

/** KILL/PAUSE 权限相关（人工 gate 强制项）。 */
const KILL_PAUSE: readonly SteeringCommandType[] = ["PAUSE", "KILL"];

/** strict-improvement 退化容忍阈值 τ（与 T04b/T05b 一致）。 */
const STRICT_IMPROVEMENT_TAU = 0;

// ── 错误类型 ───────────────────────────────────────────────────────────────

/**
 * KILL/PAUSE 权限放宽但无人工签（humanApproval !== true）。
 * KILL/PAUSE = high-risk：类比 reward-tampering ladder，权限放宽须人工 gate，
 * 绝不让 agent 自主放宽终止/暂停权限（02-orchestration §5(f)）。
 */
export class KillPauseUnsignedError extends Error {
  readonly rule: SteeringRule;
  constructor(rule: SteeringRule, message?: string) {
    super(
      message ??
        `KILL/PAUSE widen without human approval: childType='${rule.childType}' allowed=[${rule.allowed.join(", ")}] (KILL/PAUSE permission widening is human-gated; unsigned widen is rejected)`,
    );
    this.name = "KillPauseUnsignedError";
    this.rule = rule;
  }
}

/**
 * mid-stream / mid-tool 注入 steering（非 checkpoint 排空时注入）。
 * 只在 checkpoint 排空注入是流式确定性不变量——mid-stream 注入破坏幂等
 * （02-orchestration §5(b)）。
 */
export class MidStreamInjectionError extends Error {
  readonly injectedMidStream: boolean;
  constructor(injectedMidStream: boolean, message?: string) {
    super(
      message ??
        `steering injected mid-stream (injectedMidStream=${injectedMidStream}); steering may only be injected at a drained checkpoint (streaming determinism invariant, 02-orchestration §5(b))`,
    );
    this.name = "MidStreamInjectionError";
    this.injectedMidStream = injectedMidStream;
  }
}

/**
 * REDIRECT 未 abort in-flight child（consume-once / abort 不变量违反）。
 * REDIRECT 须先 abort 当前 in-flight child 再注入新意图（02-orchestration §5）。
 */
export class RedirectAbortInvariantError extends Error {
  constructor(message?: string) {
    super(
      message ??
        "REDIRECT must abort in-flight child before injecting new intent (consume-once / abort invariant)",
    );
    this.name = "RedirectAbortInvariantError";
  }
}

// ── 纯函数：strict-improvement 门 ─────────────────────────────────────────

/**
 * strict-improvement 硬门（复用 L3-T04 方向）：候选 adoptionRate↑ ∧
 * falseRejectRate↓（任一退化 ≥ τ → false）。
 *
 * 无加权求和——两目标须同时改善（与 T04b Pareto 同源：不可 scalar 化抵消）。
 */
export function steeringStrictImprovementGate(
  candidate: SteeringScore,
  baseline: SteeringScore,
  tau: number = STRICT_IMPROVEMENT_TAU,
): boolean {
  const adoptionUp = candidate.adoptionRate >= baseline.adoptionRate - tau;
  const falseRejectDown = candidate.falseRejectRate <= baseline.falseRejectRate + tau;
  // 任一指标退化超 τ → reject；同时要求至少一项严格改善（避免无变化入选）。
  const strictlyBetter =
    candidate.adoptionRate > baseline.adoptionRate ||
    candidate.falseRejectRate < baseline.falseRejectRate;
  return adoptionUp && falseRejectDown && strictlyBetter;
}

/** 是否含 KILL/PAUSE（权限放宽态）。 */
export function hasKillOrPause(rule: SteeringRule): boolean {
  return rule.allowed.some((c) => KILL_PAUSE.includes(c));
}

// ── 纯函数：steering_policy.yaml 序列化（极简，无外部依赖） ────────────────

/**
 * 把 SteeringRule[] 序列化为 `config/steering_policy.yaml` 文本。
 *
 * 形状（与 mid-run steering 加载器契约一致）：
 *   rules:
 *     - childType: <childType>
 *       allowed:
 *         - HINT
 *         - REDIRECT
 */
export function serializeSteeringPolicyYaml(
  rules: readonly SteeringRule[],
): string {
  const lines: string[] = ["rules:"];
  for (const r of rules) {
    lines.push(`  - childType: ${r.childType}`);
    lines.push("    allowed:");
    for (const cmd of r.allowed) {
      lines.push(`      - ${cmd}`);
    }
  }
  return lines.join("\n") + "\n";
}

// ── SteeringPolicy ─────────────────────────────────────────────────────────

/**
 * Steering policy 进化 driver + KILL/PAUSE 人工门 + checkpoint/consume-once 不变量守卫。
 *
 * - `evolve`：复用 beam-search driver 语义；候选 strict-improvement
 *   （adoption↑ ∧ falseReject↓）入选，产更可行动的 HINT/REDIRECT 措辞模板。
 *   仅允许加非 KILL/PAUSE 权限（HINT/REDIRECT）；KILL/PAUSE 放宽须走
 *   `assertKillPauseHumanGated` 人签后单独注入。
 * - `assertKillPauseHumanGated`：KILL/PAUSE 放宽无签 → throw。
 * - `commitSteeringPolicy`：`config/steering_policy.yaml` 的 commit 入口，
 *   内部强制对每条含 KILL/PAUSE 的规则跑 `assertKillPauseHumanGated`（同入口
 *   不可绕过，类比 SteeringPatch.commit 内部强制 assertHumanApproval）。
 * - `assertCheckpointOnly`：mid-stream 注入 → throw（只在 checkpoint 排空）。
 */
export class SteeringPolicy {
  private readonly repoRoot: string | undefined;

  constructor(opts: { repoRoot?: string } = {}) {
    this.repoRoot = opts.repoRoot;
  }
  /**
   * 进化：从 baseline + 候选信号产 evolved rules + templates。
   *
   * 正常路径：候选 strict-improvement（adoption↑ ∧ falseReject↓）→ 入选；
   * 产更可行动的 HINT 措辞模板。边界：候选加 HINT/REDIRECT 权限（非 KILL/PAUSE）
   * 且 adoption↑ → 允许。KILL/PAUSE 放宽不在此处理（须 `assertKillPauseHumanGated`
   * 人签后单独注入）。
   */
  evolve(
    rules: readonly SteeringRule[],
    templates: Record<string, string>,
    scores: SteeringScore[],
  ): { rules: readonly SteeringRule[]; templates: Record<string, string> } {
    // 拆 baseline / candidate。
    const baseline = scores.find((s) => s.isBaseline) ?? scores[0]!;
    const candidates = scores.filter((s) => !s.isBaseline);

    // 复制 templates 基线，准备进化覆盖。
    const evolvedTemplates: Record<string, string> = { ...templates };

    // 默认保留原 rules（fail-safe：无候选改善则不变）。
    let evolvedRules: readonly SteeringRule[] = rules;

    // 选首个 strict-improvement 候选（adoption↑ ∧ falseReject↓）。
    const improving = candidates.find((c) => steeringStrictImprovementGate(c, baseline));

    if (improving) {
      // 产更可行动的 HINT 措辞模板（adoption↑ 目标：更具体、可执行）。
      evolvedTemplates["HINT"] =
        "Steering HINT: before continuing, verify the current step matches the intended direction. " +
        "If not, adjust toward the suggested approach and proceed. (actionable, specific)";

      // 边界：允许加 HINT/REDIRECT 权限（非 KILL/PAUSE）给已有 childType——
      // KILL/PAUSE 放宽须走 assertKillPauseHumanGated，不在此自主放宽。
      evolvedRules = rules.map((r) => {
        const allowed = new Set<SteeringCommandType>(r.allowed as SteeringCommandType[]);
        if (!allowed.has("HINT")) allowed.add("HINT");
        return { childType: r.childType, allowed: [...allowed] } satisfies SteeringRule;
      });
    }

    return { rules: evolvedRules, templates: evolvedTemplates };
  }

  /**
   * 守卫：KILL/PAUSE 权限放宽须人工签（commit / apply 前跑）。
   *
   * `rule.allowed` 含 KILL/PAUSE 且 `humanApproval !== true` → throw
   * `KillPauseUnsignedError`。有人工签 → 放行。
   *
   * 复用 L1-T11 `HumanGate` 方向语义（人审门泛化）；本处用 boolean 签
   * （spec 接口签名），语义同「approved」。
   */
  assertKillPauseHumanGated(rule: SteeringRule, humanApproval: boolean): void {
    if (hasKillOrPause(rule) && !humanApproval) {
      throw new KillPauseUnsignedError(rule);
    }
  }

  /**
   * commit `config/steering_policy.yaml`：同入口强制跑 `assertKillPauseHumanGated`。
   *
   * 对**每条**规则强制跑 `assertKillPauseHumanGated(rule, humanApproval)`——
   * 含 KILL/PAUSE 的规则无人工签即 throw，调用方无法绕过（类比
   * SteeringPatch.commit 内部强制 assertHumanApproval 的同入口不可绕过模式）。
   * 通过后写 active `config/steering_policy.yaml` + staging 版本后缀
   * （`staging/steering-policy.v{N}.yaml`），返回 `{ committedSha }` 供下游
   * 回滚/可追溯锚点。
   *
   * 这闭合「门函数存在却未被任何生产路径调用」的不变量休眠态：commit 是
   * steering_policy.yaml 落盘的唯一入口，KILL/PAUSE 人工 gate 在此强制接线。
   *
   * @throws repoRoot 未配置 → throw（commit 须有落盘根）
   * @throws 任一含 KILL/PAUSE 规则无人工签 → throw `KillPauseUnsignedError`
   */
  commitSteeringPolicy(
    rules: readonly SteeringRule[],
    humanApproval: boolean,
  ): { committedSha: string } {
    if (this.repoRoot === undefined) {
      throw new Error(
        "SteeringPolicy.commitSteeringPolicy: no repoRoot configured (commit requires a writable repo root)",
      );
    }
    // 同入口强制 KILL/PAUSE 人工 gate（不可绕过）。
    for (const rule of rules) {
      this.assertKillPauseHumanGated(rule, humanApproval);
    }

    const yaml = serializeSteeringPolicyYaml(rules);
    const targetAbs = join(this.repoRoot, "config/steering_policy.yaml");
    mkdirSync(dirname(targetAbs), { recursive: true });
    writeFileSync(targetAbs, yaml, "utf8");

    // staging 版本后缀（keep-all variant，回滚物理基础）。
    const stagingDir = join(this.repoRoot, "staging");
    mkdirSync(stagingDir, { recursive: true });
    const next = nextSteeringVersion(stagingDir);
    writeFileSync(
      join(stagingDir, `steering-policy.v${next}.yaml`),
      yaml,
      "utf8",
    );

    const committedSha = createHash("sha256")
      .update(yaml, "utf8")
      .digest("hex");
    return { committedSha };
  }

  /**
   * 守卫：steering 只在 checkpoint 排空时注入（流式确定性不变量）。
   *
   * `injectedMidStream === true`（mid-stream / mid-tool 注入）→ throw
   * `MidStreamInjectionError`。`false`（checkpoint 排空）→ 放行。
   *
   * `rules` 入参保留以匹配 spec 签名 + 供未来 REDIRECT abort 守卫扩展
   * （REDIRECT 未 abort in-flight → throw，02-orchestration §5）。
   */
  assertCheckpointOnly(rules: readonly SteeringRule[], injectedMidStream: boolean): void {
    void rules; // 形状已由 caller 保证；本守卫只检注入时序。
    if (injectedMidStream) {
      throw new MidStreamInjectionError(injectedMidStream);
    }
  }

  /**
   * 守卫：REDIRECT 须 abort in-flight child（consume-once / abort 不变量）。
   *
   * `redirectedWithoutAbort === true` → throw `RedirectAbortInvariantError`。
   * 与 L0C streaming 契约共用（REFACTOR spec §L1-T18）。
   */
  assertRedirectAbortsInFlight(redirectedWithoutAbort: boolean): void {
    if (redirectedWithoutAbort) {
      throw new RedirectAbortInvariantError();
    }
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * 计算 staging 目录下一个可用的 `steering-policy.v{N}.yaml` 版本号（1-based）。
 * keep-all variant：不覆盖既有 staging 版本，供回滚物理基础。
 */
function nextSteeringVersion(stagingDir: string): number {
  let max = 0;
  try {
    for (const f of readdirSync(stagingDir)) {
      const m = /^steering-policy\.v(\d+)\.ya?ml$/.exec(f);
      if (m && m[1] !== undefined) {
        const n = Number(m[1]);
        if (Number.isInteger(n) && n > max) max = n;
      }
    }
  } catch {
    // staging 目录不存在 → 从 v1 起。
  }
  return max + 1;
}
