// L1-T21 · resource 排序函数 + prompts 模板体进化
// （audience:[user] 永不注入 model；破坏性 prompt 人审）
//
// Spec: execution/L1-config/TASKS.md §L1-T21。
//
// host 侧 resourceSelectionRanker 排序 + prompts 模板体进化
// （02-tools-mcp 组件6）。resources 排序按 priority+audience+lastModified+
// task-relevance 决定注入哪些；prompts 模板体作 slash-command。
//
// **control-model 分配（tools=model / resources=host / prompts=user）= static-core**。
// - `assertAudienceUserNotInjectedToModel`：audience:[user]-only resource 被注入
//   model context → throw `AudienceViolationError`（注解违约，硬拒，
//   02-tools-mcp 组件6(b/f)）。让 model 自主拉 audience:[user] 内容 = 注解违约。
// - `assertDestructivePromptHumanGated`：破坏性 prompt（含 execute 指令）无人工签
//   → throw（复用 T11 HumanGate 思路；prompts 保持 user-controlled，永不自动作
//   system 注入）。
//
// **resources 排序不用 LLM judge**——机械信号（task 成功 + token + 引用率）足够。
// **prompts 信号 = user-task 成功率**。
//
// 复用 vs 自研：
// - L3-T05 Pareto 思路复用：`evolveRanker` 以 `ResourceScore`（taskSuccess↑ ∧
//   tokenCost↓ ∧ referenceRate↑）做 Pareto 选择。
// - L3-T04 strict-improvement 复用：`evolvePromptTemplate` 候选 userTaskSuccess↑ 才入选。
// - 自研：`resource-ranker.ts`（排序 + 进化 + audience 硬拒 + 破坏性 prompt 人审门）。

// ── 公共类型 ───────────────────────────────────────────────────────────────

/**
 * MCP resource（02-tools-mcp 组件6(a)）。host 侧排序输入。
 *
 * - `uri`：resource 标识。
 * - `name`：可读名。
 * - `audience`：MCP annotations.audience（`"model"` / `"user"`）。`["user"]`-only
 *   内容永不注入 model context（硬拒）。
 * - `priority`：MCP annotations.priority（0..1，越高越优先）。
 * - `lastModified`：MCP annotations.lastModified（epoch ms；越大越新）。
 */
export interface Resource {
  readonly uri: string;
  readonly name: string;
  readonly audience: readonly string[];
  readonly priority: number;
  readonly lastModified: number;
}

/**
 * 排序权重（relevance + priority + recency）。`evolveRanker` 产出归一化（和≈1）。
 */
export interface ResourceRankerConfig {
  readonly weights: {
    readonly relevance: number;
    readonly priority: number;
    readonly recency: number;
  };
}

/**
 * resource 候选打分（机械信号，无 LLM judge）。
 *
 * - `taskSuccess`：注入该 resource 后 task 成功率（越高越好）。
 * - `tokenCost`：注入 token 成本（越低越好）。
 * - `referenceRate`：注入的 resource 被模型引用/使用率（越高越好）。
 * - `isBaseline`：基线分数（active 当前版本，作参照）。
 */
export interface ResourceScore {
  readonly taskSuccess: number;
  readonly tokenCost: number;
  readonly referenceRate: number;
  readonly isBaseline: boolean;
}

// ── 错误类型 ───────────────────────────────────────────────────────────────

/**
 * audience:[user]-only resource 被注入 model context（注解违约，硬拒）。
 * control-model 分配是安全契约：让 model 自主拉 audience:[user] 内容 = 注解违约
 * （02-tools-mcp 组件6(b/f)）。
 */
export class AudienceViolationError extends Error {
  constructor(message?: string) {
    super(
      message ??
        "audience:[user]-only resource must not be injected to model context (control-model violation)",
    );
    this.name = "AudienceViolationError";
  }
}

/**
 * 破坏性 prompt（含 execute 指令）无人工签。prompts 保持 user-controlled，
 * 破坏性操作须人审（复用 T11 HumanGate 思路）。
 */
export class DestructivePromptUnsignedError extends Error {
  constructor(message?: string) {
    super(
      message ??
        "destructive prompt (contains execute) requires human approval (human gate; prompts stay user-controlled)",
    );
    this.name = "DestructivePromptUnsignedError";
  }
}

// ── 内部工具 ───────────────────────────────────────────────────────────────

/** audience:[user]-only = 含 "user" 且不含 "model"。 */
function isUserOnly(resource: Resource): boolean {
  const aud = resource.audience;
  return aud.includes("user") && !aud.includes("model");
}

/** 归一化权重（和≈1，避免负权/全零退化）。 */
function normalizeWeights(w: {
  relevance: number;
  priority: number;
  recency: number;
}): { relevance: number; priority: number; recency: number } {
  const sum = w.relevance + w.priority + w.recency;
  if (!(sum > 0)) {
    // 退化保护：等权。
    return { relevance: 1 / 3, priority: 1 / 3, recency: 1 / 3 };
  }
  return {
    relevance: w.relevance / sum,
    priority: w.priority / sum,
    recency: w.recency / sum,
  };
}

/**
 * 从 `taskFeatures`（`unknown`，运行时形状校验）提取 task-relevance 映射。
 * 期望形状：`{ taskRelevance: Record<string, number> }`。
 */
function extractTaskRelevance(taskFeatures: unknown): Map<string, number> {
  const map = new Map<string, number>();
  if (
    typeof taskFeatures === "object" &&
    taskFeatures !== null &&
    "taskRelevance" in taskFeatures
  ) {
    const tr = (taskFeatures as { taskRelevance: unknown }).taskRelevance;
    if (typeof tr === "object" && tr !== null) {
      for (const [k, v] of Object.entries(
        tr as Record<string, unknown>,
      )) {
        if (typeof v === "number" && Number.isFinite(v)) {
          map.set(k, v);
        }
      }
    }
  }
  return map;
}

/** recency 归一化（按候选集 lastModified 最大值缩放到 0..1）。 */
function recencyNorm(lastModified: number, maxLastModified: number): number {
  if (maxLastModified <= 0) return 0;
  return Math.max(0, Math.min(1, lastModified / maxLastModified));
}

// ── ResourceRanker ─────────────────────────────────────────────────────────

/**
 * resource 排序 + 进化 + audience 硬拒 + 破坏性 prompt 人审门。
 *
 * - `rank`：按权重加权打分排序（relevance × taskRelevance + priority × priority
 *   + recency × recencyNorm）。
 * - `evolveRanker`：Pareto（taskSuccess↑ ∧ tokenCost↓ ∧ referenceRate↑）→
 *   候选非支配 baseline → nudge 权重并向 relevance（referenceRate 信号）+ 归一化。
 * - `evolvePromptTemplate`：候选 userTaskSuccess↑ → 允许加步骤指令（strict-improvement）。
 * - `assertAudienceUserNotInjectedToModel`：audience:[user]-only + 注入 model → throw。
 * - `assertDestructivePromptHumanGated`：含 execute + 无签 → throw。
 */
export class ResourceRanker {
  /**
   * 按 weights 加权打分排序 resources（降序）。
   *
   * score = w.relevance × taskRelevance(uri) + w.priority × priority
   *         + w.recency × recencyNorm(lastModified)。
   *
   * taskRelevance 缺失视为 0。返回新数组（不原地改）。
   */
  rank(
    resources: readonly Resource[],
    config: ResourceRankerConfig,
    taskFeatures: unknown,
  ): readonly Resource[] {
    const w = normalizeWeights(config.weights);
    const relevanceMap = extractTaskRelevance(taskFeatures);
    const maxLast = resources.reduce((m, r) => Math.max(m, r.lastModified), 0);

    const scored = resources.map((r) => {
      const rel = relevanceMap.get(r.uri) ?? 0;
      const rec = recencyNorm(r.lastModified, maxLast);
      const score =
        w.relevance * rel + w.priority * r.priority + w.recency * rec;
      return { r, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.r);
  }

  /**
   * 进化排序权重（Pareto）。
   *
   * 候选（isBaseline=false）相对 baseline（isBaseline=true）：
   * taskSuccess↑ ∧ tokenCost↓ ∧ referenceRate↑（非支配）→ nudge 权重向
   * relevance（referenceRate 是 relevance 信号的直接体现）+ 归一化（和≈1）。
   * 无非支配候选 → 透传原 config（归一化后）。
   *
   * 返回新 config（不原地改）。
   */
  evolveRanker(
    config: ResourceRankerConfig,
    scores: readonly ResourceScore[],
  ): ResourceRankerConfig {
    const baseline = scores.find((s) => s.isBaseline);
    const candidates = scores.filter((s) => !s.isBaseline);

    let nudgeRelevance = 0;
    if (baseline) {
      for (const cand of candidates) {
        const dominates =
          cand.taskSuccess >= baseline.taskSuccess &&
          cand.tokenCost <= baseline.tokenCost &&
          cand.referenceRate >= baseline.referenceRate &&
          (cand.taskSuccess > baseline.taskSuccess ||
            cand.tokenCost < baseline.tokenCost ||
            cand.referenceRate > baseline.referenceRate);
        if (dominates) {
          // referenceRate↑ → relevance 信号更可信 → nudge relevance。
          nudgeRelevance += 0.05;
        }
      }
    }

    const evolved = normalizeWeights({
      relevance: config.weights.relevance + nudgeRelevance,
      priority: config.weights.priority,
      recency: config.weights.recency,
    });
    return { weights: Object.freeze(evolved) };
  }

  /**
   * 进化 prompts 模板体（strict-improvement）。
   *
   * 候选 userTaskSuccess > baseline → 允许加步骤指令（进化加步骤且 success↑ → 入选，
   * spec 边界）。返回进化后模板（追加一条验证步骤）；无提升 → 透传原模板。
   * prompts 永不自动作 system 注入（保持 user-controlled）。
   */
  evolvePromptTemplate(
    template: string,
    scores: readonly { userTaskSuccess: number }[],
  ): string {
    const baseline = scores[0];
    const candidates = scores.slice(1);
    let improved = false;
    if (baseline) {
      for (const cand of candidates) {
        if (cand.userTaskSuccess > baseline.userTaskSuccess) {
          improved = true;
          break;
        }
      }
    }
    if (!improved) return template;
    // 加步骤指令（进化加步骤且 success↑ → 允许）。
    const step = "4. Re-verify the result satisfies the user task success criteria.\n";
    if (template.endsWith("\n")) return template + step;
    return template + "\n" + step;
  }

  /**
   * 守卫：audience:[user]-only resource 永不注入 model context（硬拒）。
   *
   * audience 含 "user" 且不含 "model"（user-only）+ `injectedToModel===true`
   * → throw `AudienceViolationError`（control-model 分配安全契约，
   * 02-tools-mcp 组件6(b/f)）。
   * 不注入 model / 非 user-only → 通过。
   */
  assertAudienceUserNotInjectedToModel(
    resource: Resource,
    injectedToModel: boolean,
  ): void {
    if (isUserOnly(resource) && injectedToModel) {
      throw new AudienceViolationError(
        `resource '${resource.uri}' audience:[user]-only must not be injected to model context (control-model violation; 02-tools-mcp comp6(b/f))`,
      );
    }
  }

  /**
   * 守卫：破坏性 prompt（含 execute 指令）须人审。
   *
   * 模板含 `execute`（大小写不敏感）+ `humanApproval===false`（无签）
   * → throw `DestructivePromptUnsignedError`（prompts 保持 user-controlled；
   * 复用 T11 HumanGate 思路）。
   * 含 execute + 已签 / 不含 execute → 通过。
   */
  assertDestructivePromptHumanGated(
    template: string,
    humanApproval: boolean,
  ): void {
    const isDestructive = /\bexecute\b/i.test(template);
    if (isDestructive && !humanApproval) {
      throw new DestructivePromptUnsignedError(
        "destructive prompt (contains 'execute') requires human approval (human gate; prompts stay user-controlled)",
      );
    }
  }
}
