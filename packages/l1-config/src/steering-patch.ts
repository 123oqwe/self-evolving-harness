// L1-T11 · CLAUDE.md/steering patch 基质（ExpeL insight 驱动；人审每 diff）
//
// CLAUDE.md / `.kiro/steering/*.md` 是 project steering 基质（02-loop-context
// §2.7(b)；PRD §5.1）。进化 = 离线元循环从 trajectory 库提「agent 反复犯的
// project 级错误」（ExpeL insight extraction，L2-T04b），产 patch 候选；
// **人审每 diff**（+16.2pp gap 决定人 governance 必需，02-loop-context
// §2.7(e/f)）。agent 运行时只读 CLAUDE.md，不可改（scope 广→窄 static-core）。
//
// 安全门（commit 前跑）：
// - `assertHumanApproval`：humanApproval !== 'approved' → throw
//   `UnapprovedSteeringPatchError`（无人审 diff → reject）。
// - `assertDecontaminated`：canary 反降分（疑似 memorize SWE-bench）→ throw。
// - `assertScopeOrderAllowed`：patch 改 scope 顺序（user 覆盖 project）→ reject
//   （scope 广→窄 static-core）。
//
// 复用 vs 自研：
// - L2-T04b（ExpeL insight 蒸馏管线）提供 insight 输入（`ExpeLInsight`）。
// - CE-T01a（SWE-rebench 去污染 canary）提供 decontaminated 验证信号。
// - 自研：候选生成 + 人审门 + decontaminated 守卫 + scope 顺序守卫。
//
// REFACTOR（spec §L1-T11）：把「人审门」抽象为 `HumanGate{require approval
// field}`，供 T17 鉴权字段 / T18 KILL/PAUSE 复用。

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

// ── 公共类型 ───────────────────────────────────────────────────────────────

/**
 * ExpeL insight（来自 L2-T04b 蒸馏管线）。
 * - `clusterId`/`insightId`：provenance（候选回链到 trajectory 簇）。
 * - `summary`：agent 反复犯的 project 级错误摘要。
 * - `severity`：[0,1] 严重度（越高越优先产 patch）。
 */
export interface ExpeLInsight {
  readonly clusterId: string;
  readonly insightId: string;
  readonly summary: string;
  readonly severity: number;
}

/**
 * Steering patch 候选（`src/steering-patch.ts`）。
 * - `filePath`：`CLAUDE.md` 或 `.kiro/steering/*.md`（git-versioned 基质）。
 * - `patch`：unified diff（人审每 diff）。
 * - `insightProvenance`：回链到 L2-T04b ExpeL insight 簇。
 * - `humanApproval`：人审状态（每 diff 必审；`approved` 才可 commit）。
 */
export interface SteeringPatchCandidate {
  readonly id: string;
  readonly filePath: string;
  readonly patch: string;
  readonly insightProvenance: { clusterId: string; insightId: string };
  readonly humanApproval: "pending" | "approved" | "rejected";
}

/**
 * decontaminated canary 结果（CE-T01a SWE-rebench 去污染验证）。
 * - `resolveRate`：held-out canary resolve 率（反降 → 疑似 memorize）。
 * - `decontaminated`：去污染通过（无 SWE-bench 捷径 hint 泄漏）。
 */
export interface CanaryResult {
  readonly resolveRate: number;
  readonly decontaminated: boolean;
}

// ── 常量 ───────────────────────────────────────────────────────────────────

/**
 * staging 目录（候选落此，不进 active；PRD §6.5）。
 */
const STAGING_DIR = "staging";

/**
 * decontaminated canary resolve 率下限（static-core）。
 * 低于此 → 疑似 memorize SWE-bench → reject。
 */
const DECONTAMINATION_RESOLVE_FLOOR = 0.5;

/**
 * scope 顺序 static-core：广→窄（user → project → ...）。
 * 任何 patch 试图让窄 scope 覆盖广 scope（如 user overrides project）→ reject。
 * 关键词集用于启发式检测 patch 文本中的 scope 反转。
 */
const SCOPE_REVERSAL_PATTERNS: readonly RegExp[] = [
  /user\s+overrides?\s+project/i,
  /project\s+overrides?\s+user/i,
  /\buser\s+scope\b/i,
  /\bnarrower\s+overrides?\s+wider/i,
];

// ── 错误类型 ───────────────────────────────────────────────────────────────

/**
 * 未经人审的 steering patch（humanApproval !== 'approved'）。
 * 人审每 diff = +16.2pp gap 的直接工程后果——绝不让 agent 自主改 CLAUDE.md。
 */
export class UnapprovedSteeringPatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnapprovedSteeringPatchError";
  }
}

/**
 * decontaminated canary 反降分（疑似 memorize SWE-bench 捷径 hint）。
 */
export class DecontaminationRegressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecontaminationRegressionError";
  }
}

/**
 * patch 改 scope 顺序（user 覆盖 project；scope 广→窄 static-core 破坏）。
 */
export class ScopeOrderReversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeOrderReversalError";
  }
}

// ── HumanGate（REFACTOR：人审门泛化） ──────────────────────────────────────

/**
 * 泛化人审门（spec §L1-T11 REFACTOR）。
 * 供 T17 鉴权字段 / T18 KILL/PAUSE 复用：要求某字段为 'approved' 才放行。
 */
export interface HumanGate {
  readonly requireField: "humanApproval";
  readonly approvedValue: "approved";
}

const STEERING_HUMAN_GATE: HumanGate = {
  requireField: "humanApproval",
  approvedValue: "approved",
};

// ── SteeringPatch ───────────────────────────────────────────────────────────

export interface SteeringPatchOptions {
  readonly repoRoot: string;
}

/**
 * CLAUDE.md/steering patch 基质（ExpeL insight 驱动；人审每 diff）。
 *
 * - `generateCandidates`：调 ExpeL insight 产 patch 候选（unified diff），
 *   每个带 `humanApproval:'pending'`（人审每 diff）。
 * - `assertHumanApproval`：人审门（commit 前跑）。
 * - `assertDecontaminated`：去污染 canary 守卫（commit 前跑）。
 * - `assertScopeOrderAllowed`：scope 顺序守卫（commit 前跑）。
 * - `commit`：人审 approve +（可选）decontaminated + scope 顺序 OK → 写
 *   `CLAUDE.md` + staging 版本后缀（`staging/<basename>.v{N}.md`），返回
 *   `{ committedSha }` 供下游回滚/可追溯锚点（ERRATA-w2plus L1-06）。
 */
export class SteeringPatch {
  private readonly repoRoot: string;

  constructor(opts: SteeringPatchOptions) {
    this.repoRoot = opts.repoRoot;
  }

  /**
   * 从 ExpeL insight 簇产 patch 候选。
   *
   * 每个 insight → 一个候选（默认 `filePath='CLAUDE.md'`，severity 高的
   * 优先）。patch 为 unified diff 文本（人审每 diff）。所有候选
   * `humanApproval='pending'`（绝不自动 approved）。
   */
  async generateCandidates(
    insights: readonly ExpeLInsight[],
  ): Promise<SteeringPatchCandidate[]> {
    const sorted = [...insights].sort((a, b) => b.severity - a.severity);
    const candidates: SteeringPatchCandidate[] = sorted.map((insight, idx) => {
      const id = `sp-${insight.clusterId}-${insight.insightId}-${idx}`;
      // unified diff 文本：追加一条 project 级规则（人审可改）。
      const patch =
        `@@ CLAUDE.md @@\n` +
        `+ ${insight.summary}\n` +
        `+ (ExpeL insight ${insight.clusterId}/${insight.insightId}, severity=${insight.severity.toFixed(2)})\n`;
      return Object.freeze({
        id,
        filePath: "CLAUDE.md",
        patch,
        insightProvenance: {
          clusterId: insight.clusterId,
          insightId: insight.insightId,
        },
        humanApproval: "pending" as const,
      });
    });
    return candidates;
  }

  /**
   * 守卫：人审门（HumanGate，commit 前跑）。
   *
   * `humanApproval !== 'approved'`（pending / rejected）→ throw
   * `UnapprovedSteeringPatchError`（无人审 diff → reject）。
   */
  assertHumanApproval(candidate: SteeringPatchCandidate): void {
    const gate = STEERING_HUMAN_GATE;
    const value = candidate[gate.requireField];
    if (value !== gate.approvedValue) {
      throw new UnapprovedSteeringPatchError(
        `steering patch '${candidate.id}' humanApproval='${value}' (require '${gate.approvedValue}'; human gate per-diff, +16.2pp gap)`,
      );
    }
  }

  /**
   * 守卫：decontaminated canary（commit 前跑）。
   *
   * - `decontaminated===false`（去污染失败，疑似 SWE-bench 捷径 hint 泄漏）→
   *   throw `DecontaminationRegressionError`。
   * - `resolveRate < floor`（held-out 反降分，疑似 memorize SWE-bench）→
   *   throw `DecontaminationRegressionError`。
   *
   * 通过 = decontaminated 且 resolveRate 不降。
   */
  assertDecontaminated(candidate: SteeringPatchCandidate, canaryResult: CanaryResult): void {
    if (!canaryResult.decontaminated) {
      throw new DecontaminationRegressionError(
        `steering patch '${candidate.id}' canary not decontaminated (suspected SWE-bench shortcut hint; 02-loop-context §2.7(e))`,
      );
    }
    if (canaryResult.resolveRate < DECONTAMINATION_RESOLVE_FLOOR) {
      throw new DecontaminationRegressionError(
        `steering patch '${candidate.id}' canary resolveRate=${canaryResult.resolveRate} below floor ${DECONTAMINATION_RESOLVE_FLOOR} (reverse-degrade; suspected memorize SWE-bench)`,
      );
    }
  }

  /**
   * 守卫：scope 顺序（static-core，commit 前跑）。ERRATA-w2plus L1-06 命名。
   *
   * patch 文本含 scope 反转模式（user 覆盖 project 等）→ throw
   * `ScopeOrderReversalError`（scope 广→窄 static-core 破坏）。
   */
  assertScopeOrderAllowed(candidate: SteeringPatchCandidate): void {
    for (const pat of SCOPE_REVERSAL_PATTERNS) {
      if (pat.test(candidate.patch)) {
        throw new ScopeOrderReversalError(
          `steering patch '${candidate.id}' reverses scope order (user overrides project; scope wider→narrower static-core violated)`,
        );
      }
    }
  }

  /**
   * commit 候选：人审 approve +（可选 decontaminated canary）+ scope 顺序 OK
   * → 写 `filePath`（CLAUDE.md / .kiro/steering/*.md）+ staging 版本后缀，
   * 返回 `{ committedSha }` 供下游回滚/可追溯锚点（ERRATA-w2plus L1-06）。
   *
   * 安全（ERRATA-w2plus 安全审查）：`canaryResult` 传入时 commit 内部强制跑
   * `assertDecontaminated`，使人审门 + 去污染门 + scope 门在同一入口不可绕过
   * —— 调用方（L3 进化 loop）传 canaryResult 即自动收齐三道门，无需另显式跑。
   * 不传 canaryResult 时退化为「人审门 + scope 门」（调用方须自行先跑
   * `assertDecontaminated`），保留既有显式调用契约。
   *
   * staging 版本后缀（`staging/<basename>.v{N}.md`，keep-all variant）是回滚
   * 的物理基础（PRD §6.4）。`committedSha` = 已写入 active 文件内容的
   * sha256，作为本次 commit 的可追溯锚点（下游 T04b/T05b/CE-T06 回滚点）。
   */
  commit(
    candidate: SteeringPatchCandidate,
    canaryResult?: CanaryResult,
  ): { committedSha: string } {
    // 人审门（commit 前跑）
    this.assertHumanApproval(candidate);
    // 去污染门：传入 canaryResult 时 commit 内部强制跑（ERRATA 安全：同入口不可绕过）
    if (canaryResult !== undefined) {
      this.assertDecontaminated(candidate, canaryResult);
    }
    // scope 顺序守卫（commit 前跑）
    this.assertScopeOrderAllowed(candidate);

    const targetAbs = join(this.repoRoot, candidate.filePath);
    // 追加 patch 行（unified diff 中的 `+` 行 → 追加内容；`-` 行忽略）。
    const addition = extractAdditions(candidate.patch);
    let committed = "";
    if (addition.length > 0) {
      let prev = "";
      if (existsSync(targetAbs)) {
        prev = readFileSync(targetAbs, "utf8");
      }
      const next = prev.endsWith("\n") || prev === ""
        ? prev + addition + "\n"
        : prev + "\n" + addition + "\n";
      writeFileSync(targetAbs, next, "utf8");
      committed = next;
    } else if (existsSync(targetAbs)) {
      committed = readFileSync(targetAbs, "utf8");
    }

    // staging 版本后缀（keep-all variant，回滚物理基础）
    const stagingDir = join(this.repoRoot, STAGING_DIR);
    mkdirSync(stagingDir, { recursive: true });
    const base = basenameWithoutExt(candidate.filePath);
    const next = nextVersion(stagingDir, base);
    const stagingAbs = join(stagingDir, `${base}.v${next}.md`);
    writeFileSync(stagingAbs, addition, "utf8");

    // 可追溯锚点：已写入 active 文件内容的 sha256
    const committedSha = createHash("sha256").update(committed, "utf8").digest("hex");
    return { committedSha };
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * 从 unified diff 文本提取 `+` 行内容（去 `+` 前缀），忽略 `---`/`+++` 头与
 * `-` 行。用于 commit 时追加到 active 文件。
 */
function extractAdditions(patch: string): string {
  const lines = patch.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) {
      out.push(line.slice(1).replace(/^\s/, ""));
    }
  }
  return out.join("\n").trim();
}

/**
 * 取文件路径 basename 去扩展名（`CLAUDE.md` → `CLAUDE`；
 * `.kiro/steering/product.md` → `product`）。
 */
function basenameWithoutExt(filePath: string): string {
  const base = filePath.split("/").pop() ?? filePath;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * 扫描 staging 目录现有 `<base>.v{N}.md`，返回下一版本号（最小起步 2）。
 */
function nextVersion(stagingDir: string, base: string): number {
  let max = 1;
  if (existsSync(stagingDir)) {
    for (const name of readdirSync(stagingDir) as string[]) {
      const m = name.match(new RegExp(`^${escapeRegExp(base)}\\.v(\\d+)\\.md$`));
      if (m) {
        const g = m[1];
        const n = g !== undefined ? parseInt(g, 10) : NaN;
        if (Number.isFinite(n) && n > max) max = n;
      }
    }
  }
  return max + 1;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
