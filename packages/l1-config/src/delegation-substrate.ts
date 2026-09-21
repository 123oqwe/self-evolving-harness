// L1-T14 · delegation spec/effort-scaling 基质 + 进化（必填字段名 static-core；变异器独立 session）
//
// delegation spec 模板（`config/delegation_template.md`）+ effort-scaling 规则表
// （`config/effort_scaling.yaml`，`{complexity_band: {agent_count, call_budget}}`）
// 是 orchestration 层的被进化基质（02-orchestration §1）。进化的对象 = 模板措辞
// / acceptance criteria 句式 + effort-scaling 数值（agent_count / call_budget）。
//
// **必填字段名集合**（objective / repo / authority / acceptance / validation /
// expectedOutput）= static-core：child agent 据此正确执行 delegation，改字段名 =
// 破坏契约，只允许改措辞/数值（02-orchestration §1(b)）。`assertRequiredFieldsIntact`
// 扫描候选模板，缺任一必填字段名 → throw `RequiredFieldMissingError`。
//
// **变异器独立 session**（防 self-preference / Sycophancy-to-Subfuge ladder，
// 02-orchestration §1(f)）：mutator 须在与被评估 orchestrator 不同的 session 中
// 执行。`evolve` 调沙箱执行 mutator，`mutatorSessionId === orchestratorSessionId`
// → throw `MutatorSessionViolation`。
//
// 信号 = child 在 call_budget 内达成 acceptance（acceptanceRate↑）+ 重派率
// （reDispatchRate↓）。strict-improvement 门：任一退化 ≥ τ → reject。
//
// 复用 vs 自研：
// - L3-T03（reflective mutation 生成器，独立 session）提供 `LlmMutator` /
//   `SandboxExecutor` / `FailureTrajectory` 形状（自 evolution-driver 复用导入）。
// - L3-T04 strict-improvement 复用：本任务以 `DelegationScore`（acceptance↑ ∧
//   reDispatch↓）实现专属 strict-improvement 门。
// - 自研：`delegation-substrate.ts`（加载 + 进化 driver + 必填字段锁 + 独立
//   session 守卫）；`effort_scaling.yaml` 解析；`FieldLock`（REFACTOR：必填字段锁
//   抽象，供 T17 handoff input_type 必填字段复用）。
//
// REFACTOR（spec §L1-T14）：把「必填字段锁」抽成 `FieldLock{required: string[]}`，
// 供 T17 handoff input_type 必填字段复用。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConfigRepo } from "./repo-layout.js";
import type {
  LlmMutator,
  SandboxExecutor,
  FailureTrajectory,
} from "./evolution-driver.js";

// 复用 L1-T04a 公共类型，供本模块消费者从单一入口导入（与 tool-evolution 同构）。
export type { LlmMutator, SandboxExecutor, FailureTrajectory };

// ── 常量 ───────────────────────────────────────────────────────────────────

/**
 * delegation template 必填字段名集合（static-core）。
 * child agent 据此正确执行 delegation；改字段名 = 破坏契约，只允许改措辞/数值。
 */
export const REQUIRED_FIELDS = [
  "objective",
  "repo",
  "authority",
  "acceptance",
  "validation",
  "expectedOutput",
] as const;

/** delegation template active 路径（相对 repo root）。 */
const DELEGATION_TEMPLATE_PATH = "config/delegation_template.md";
/** effort-scaling active 路径（相对 repo root）。 */
const EFFORT_SCALING_PATH = "config/effort_scaling.yaml";

/** strict-improvement 默认退化容忍阈值 τ（PRD §6.7；与 T04b/T05b 一致）。 */
const DEFAULT_TAU = 0.02;

// ── FieldLock（REFACTOR：必填字段锁泛化） ──────────────────────────────────

/**
 * 泛化必填字段锁（spec §L1-T14 REFACTOR）。
 * 供 T17 handoff input_type 必填字段复用：扫描文本须含每个 required 字段名。
 */
export interface FieldLock {
  readonly required: readonly string[];
}

const DELEGATION_FIELD_LOCK: FieldLock = {
  required: REQUIRED_FIELDS,
};

// ── 公共类型 ───────────────────────────────────────────────────────────────

/**
 * effort-scaling 单条数值表项。
 * - `band`：复杂度档（如 'low' / 'high'）。
 * - `agents`：该档分配的 child agent 数。
 * - `calls`：call_budget 区间 [下限, 上限]（数值可调，spec 边界：calls 上限可调）。
 */
export interface EffortScaling {
  readonly band: string;
  readonly agents: number;
  readonly calls: readonly [number, number];
}

/**
 * delegation 进化信号。
 * - `acceptanceRate`：child 在 call_budget 内达成 acceptance 的比例（越高越好）。
 * - `reDispatchRate`：重派率（越低越好）。
 * - `isBaseline`：是否 baseline（当前生效 template/scaling 的信号）。
 */
export interface DelegationScore {
  readonly acceptanceRate: number;
  readonly reDispatchRate: number;
  readonly isBaseline: boolean;
}

// ── 错误类型 ───────────────────────────────────────────────────────────────

/**
 * 候选 template 缺必填字段名（static-core 契约破坏）。
 * 改字段名 = 破坏 child 能正确执行的 contract，只允许改措辞/数值。
 */
export class RequiredFieldMissingError extends Error {
  readonly missingFields: readonly string[];
  constructor(missingFields: readonly string[], message?: string) {
    super(
      message ??
        `required field name(s) missing in delegation template: ${missingFields.join(", ")} (static-core contract; only wording/values may evolve)`,
    );
    this.name = "RequiredFieldMissingError";
    this.missingFields = missingFields;
  }
}

/**
 * 变异器与被评估 orchestrator 同 session（self-preference 风险）。
 * 防 Sycophancy-to-Subfuge ladder（02-orchestration §1(f)）：mutator 须在独立
 * session 执行，不得与被评估 orchestrator 共享 session。
 */
export class MutatorSessionViolation extends Error {
  readonly sessionId: string;
  constructor(sessionId: string, message?: string) {
    super(
      message ??
        `mutator session '${sessionId}' must differ from orchestrator session (anti self-preference; 02-orchestration §1(f))`,
    );
    this.name = "MutatorSessionViolation";
    this.sessionId = sessionId;
  }
}

// ── evolve opts ────────────────────────────────────────────────────────────

/**
 * `DelegationSubstrate.evolve` opts。
 *
 * - `mutator`/`sandbox`：复用 L1-T04a 形状（L3-T03 reflective mutation 生成器 +
 *   L0S-T02 沙箱）。mutator 在沙箱内、独立 session 执行。
 * - `orchestratorSessionId`：被评估 orchestrator 的 session id（mutator 须 ≠ 此值）。
 * - `mutatorSessionId`：可选显式注入的 mutator session id（测试/审计用）；缺省时
 *   driver 生成一个独立于 orchestratorSessionId 的 session id。
 */
export interface DelegationEvolveOptions {
  readonly mutator: LlmMutator;
  readonly sandbox: SandboxExecutor;
  readonly orchestratorSessionId: string;
  readonly mutatorSessionId?: string;
  /** strict-improvement 退化容忍阈值 τ（缺省 DEFAULT_TAU）。 */
  readonly tau?: number;
}

// ── DelegationSubstrate ────────────────────────────────────────────────────

/**
 * DelegationSubstrate 构造 opts。
 * `repo`：ConfigRepo（load 读 active template + scaling；evolve 不触盘）。可选
 * 注入——`load` 亦接受 repo 参数（参数优先）；`assertRequiredFieldsIntact` /
 * `strictImprovementGate` 为纯函数不需 repo。
 */
export interface DelegationSubstrateOptions {
  readonly repo?: ConfigRepo;
}

/**
 * delegation spec/effort-scaling 基质加载 + 进化 driver。
 *
 * - `load(repo)`：读 `config/delegation_template.md` + `config/effort_scaling.yaml`
 *   active 内容，返回 `{ template, scaling }`。
 * - `assertRequiredFieldsIntact(template)`：必填字段名锁（static-core）。缺任一
 *   必填字段名 → throw `RequiredFieldMissingError`。
 * - `strictImprovementGate(cand, baseline, tau)`：acceptance↑ ∧ reDispatch↓
 *   strict-improvement 硬门（任一退化 ≥ τ → false）。
 * - `evolve(template, scaling, scores, failures, opts)`：调 mutator reflective
 *   mutation（沙箱内、独立 session）产候选 template，经必填字段锁预检 → 返回
 *   候选 `{ template, scaling }`。mutatorSessionId === orchestratorSessionId →
 *   throw `MutatorSessionViolation`。
 */
export class DelegationSubstrate {
  private readonly repo: ConfigRepo | undefined;

  constructor(opts: DelegationSubstrateOptions) {
    this.repo = opts.repo;
  }

  /**
   * 加载 delegation 基质 active 快照。
   *
   * 读 `config/delegation_template.md`（template 全文）+ `config/effort_scaling.yaml`
   * （解析为 `EffortScaling[]`）。`repo` 参数优先于构造注入的 repo。
   */
  load(repo: ConfigRepo): { template: string; scaling: readonly EffortScaling[] } {
    const root = repo.getRoot();
    const template = readFileSync(join(root, DELEGATION_TEMPLATE_PATH), "utf8");
    const yaml = readFileSync(join(root, EFFORT_SCALING_PATH), "utf8");
    const scaling = parseEffortScaling(yaml);
    return { template, scaling };
  }

  /**
   * 必填字段名锁（static-core，FieldLock 实现）。
   *
   * 扫描 template，每个必填字段名须以 markdown header（`## <field>`）出现。
   * 缺任一 → throw `RequiredFieldMissingError`（改字段名 = 破坏 child 契约，
   * 只允许改措辞/数值）。
   */
  assertRequiredFieldsIntact(template: string): void {
    assertFieldsIntact(DELEGATION_FIELD_LOCK, template);
  }

  /**
   * strict-improvement 硬门：acceptance↑ ∧ reDispatch↓，任一退化 ≥ τ → false。
   *
   * - acceptanceRate：越高越好；退化 = baseline - cand >= τ → reject。
   * - reDispatchRate：越低越好；退化 = cand - baseline >= τ → reject。
   *
   * 纯函数无 IO，便于 canary 对抗场景复用（与 T04b strictImprovementGate 同构）。
   */
  strictImprovementGate(
    cand: DelegationScore,
    baseline: DelegationScore,
    tau: number,
  ): boolean {
    // acceptanceRate 越高越好：candidate < baseline 为退化
    if (baseline.acceptanceRate - cand.acceptanceRate >= tau) return false;
    // reDispatchRate 越低越好：candidate > baseline 为退化
    if (cand.reDispatchRate - baseline.reDispatchRate >= tau) return false;
    return true;
  }

  /**
   * 进化 delegation 基质：调 mutator reflective mutation（沙箱内、独立 session）
   * 产候选 template，经必填字段锁预检 → 返回候选 `{ template, scaling }`。
   *
   * 安全不变量（spec §L1-T14 错误路径）：
   * - mutatorSessionId === orchestratorSessionId → throw `MutatorSessionViolation`
   *   （防 self-preference / Sycophancy-to-Subfuge ladder）。
   * - 候选删必填字段名 → `assertRequiredFieldsIntact` throw
   *   `RequiredFieldMissingError`（不返回候选）。
   * - mutator 在沙箱内、独立 session 执行（mutatorSession ≠ orchestratorSession）。
   *
   * `scaling` 当前原样回传（数值调整由调用方据 scores 在 select 阶段决策；本 driver
   * 聚焦 template 措辞变异 + 必填字段锁 + 独立 session 守卫）。
   */
  async evolve(
    template: string,
    scaling: readonly EffortScaling[],
    _scores: readonly DelegationScore[],
    failures: readonly FailureTrajectory[],
    opts: DelegationEvolveOptions,
  ): Promise<{ template: string; scaling: readonly EffortScaling[] }> {
    // 独立 session 守卫：mutatorSessionId 须 ≠ orchestratorSessionId
    const mutatorSessionId =
      opts.mutatorSessionId ?? nextMutatorSessionId(opts.orchestratorSessionId);
    if (mutatorSessionId === opts.orchestratorSessionId) {
      throw new MutatorSessionViolation(mutatorSessionId);
    }

    // mutator 在沙箱内、独立 session 执行（防 self-preference + injection 持久化）
    const patched = await opts.sandbox.run(
      () => opts.mutator.mutate(template, [...failures]),
      { sessionId: mutatorSessionId },
    );

    // 必填字段锁预检：候选删必填字段名 → throw（不返回候选）
    this.assertRequiredFieldsIntact(patched);

    return { template: patched, scaling };
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * FieldLock 实现：扫描 text，每个 required 字段须以 markdown header
 * （`## <field>`）出现。缺任一 → throw `RequiredFieldMissingError`。
 *
 * 抽出供 T17 handoff input_type 必填字段复用（spec §L1-T14 REFACTOR）。
 */
export function assertFieldsIntact(lock: FieldLock, text: string): void {
  const missing: string[] = [];
  for (const field of lock.required) {
    const re = new RegExp(`^##\\s+${escapeRegExp(field)}\\s*$`, "m");
    if (!re.test(text)) {
      missing.push(field);
    }
  }
  if (missing.length > 0) {
    throw new RequiredFieldMissingError(missing);
  }
}

/**
 * 生成一个独立于 orchestratorSessionId 的 mutator session id。
 * 防 self-preference（PRD §6.2/E2）与 prompt injection 持久化（R17）。
 */
function nextMutatorSessionId(orchestratorSessionId: string): string {
  const sid = `mutator-session-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (sid === orchestratorSessionId) {
    return `${sid}-distinct`;
  }
  return sid;
}

/**
 * 解析 `effort_scaling.yaml` 为 `EffortScaling[]`。
 *
 * 支持形状：
 * ```
 * bands:
 *   - band: low
 *     agents: 1
 *     calls: [5, 10]
 *   - band: high
 *     agents: 3
 *     calls: [20, 40]
 * ```
 *
 * 最小手写解析（本包无 yaml 依赖，与 T06/T09 自研 parser 风格一致）。
 */
export function parseEffortScaling(content: string): EffortScaling[] {
  const lines = content.split(/\r?\n/);
  const out: EffortScaling[] = [];
  let inBands = false;
  let cur: { band?: string; agents?: number; calls?: number[] } | null = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    // 顶层 `bands:` 进入列表块
    if (!line.startsWith(" ") && /^bands:\s*$/.test(line)) {
      inBands = true;
      continue;
    }
    if (!line.startsWith(" ")) {
      // 离开 bands 块
      if (cur) flush();
      inBands = false;
      continue;
    }
    if (!inBands) continue;
    const trimmed = line.replace(/\t/, "  ");
    // 列表项起点：`  - band: low`
    const itemMatch = trimmed.match(/^\s+-\s+band:\s*(.+)$/);
    if (itemMatch) {
      if (cur) flush();
      cur = { band: itemMatch[1]!.trim(), calls: [] };
      continue;
    }
    if (!cur) continue;
    const agentsMatch = trimmed.match(/^\s+agents:\s*(\d+)\s*$/);
    if (agentsMatch) {
      cur.agents = parseInt(agentsMatch[1]!, 10);
      continue;
    }
    const callsMatch = trimmed.match(/^\s+calls:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]\s*$/);
    if (callsMatch) {
      cur.calls = [parseInt(callsMatch[1]!, 10), parseInt(callsMatch[2]!, 10)];
      continue;
    }
  }
  if (cur) flush();
  return out;

  function flush(): void {
    if (!cur) return;
    const band = cur.band ?? "";
    const agents = cur.agents ?? 0;
    const calls: readonly [number, number] =
      cur.calls && cur.calls.length >= 2
        ? [cur.calls[0]!, cur.calls[1]!]
        : [0, 0];
    out.push(Object.freeze({ band, agents, calls }) as EffortScaling);
    cur = null;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
