// TL-T06: budget_policy + runaway-loop detector
//
// budget_policy.yaml 含 per_agent_budget / runaway_loop_threshold /
// price_table_version。runaway_loop_threshold 连续 N 次同工具调用 → abort。
// agent 不可运行时改（防 reward tampering，Everitt CRMDP）。
//
// 所有 *_policy.yaml 项目 scope 不可覆写（防 prompt-injected 仓库改预算偷数据，
// PRD §11.2）。assertMutableByAgent 基于 process.env.SEH_ROLE 判定进程角色。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// 默认 scope budget_policy.yaml 路径：与 src/ 同级的 config/ 下，git-versioned、
// 离线元循环改写、agent 运行时只读（static-core/config 边界的 source-of-truth）。
// 不随二进制发布的 TS 常量 —— 防 reward tampering（PRD §11.2 / research §3）。
const DEFAULT_BUDGET_POLICY_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "config",
  "budget_policy.yaml",
);

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

/** agent 运行时进程试图改预算/runaway 阈值 → 抛此错（reward tampering 守卫）。 */
export class RewardTamperingError extends Error {
  constructor(message = "agent process cannot mutate budget_policy (reward tampering guard)") {
    super(message);
    this.name = "RewardTamperingError";
  }
}

/** 项目 scope 试图覆写 budget_policy.yaml → 抛此错（项目 scope 不可覆写）。 */
export class ProjectScopeOverrideRejectedError extends Error {
  constructor(message = "project scope cannot override budget_policy.yaml") {
    super(message);
    this.name = "ProjectScopeOverrideRejectedError";
  }
}

// ---------------------------------------------------------------------------
// 类型（static-core 接口契约，字段名/可选性一字不差）
// ---------------------------------------------------------------------------

export interface ToolCall {
  toolName: string;
}

export interface BudgetConfig {
  per_agent_budget: number; // token 上限，默认 Infinity
  runaway_loop_threshold: number; // 连续同工具调用上限，默认 10
  price_table_version: string;
}

export interface BudgetPolicy {
  // 无参读默认 configPath；若构造期注入了 projectScopePath → 抛
  // ProjectScopeOverrideRejectedError（项目 scope 不可覆写）
  load(): BudgetConfig;
  // spent/limit 单位为 token 计数；spent 经构造期 opts.getSpent 查询；
  // exceeded = spent > limit（严格大于）
  checkBudget(
    sessionId: string,
    agentId: string,
  ): { exceeded: boolean; spent: number; limit: number };
  // count = recentToolCalls 中最大连续同 toolName 调用次数；
  // runaway = count > runaway_loop_threshold（严格大于）；非触发态 count <= threshold
  detectRunaway(recentToolCalls: ToolCall[]): {
    runaway: boolean;
    toolName: string | null;
    count: number;
  };
  assertMutableByAgent(): void; // 读 process.env.SEH_ROLE，==='agent' 时抛 RewardTamperingError
}

// ---------------------------------------------------------------------------
// 极简 YAML 解析（budget_policy.yaml 是 flat key: value 结构）
// 不引入 js-yaml 依赖；仅支持 `key: value` 行 + 注释 + 空行。
// 数字解析失败时回落为字符串。
// ---------------------------------------------------------------------------

function parseBudgetYaml(content: string): BudgetConfig {
  const out: BudgetConfig = {
    per_agent_budget: Infinity,
    runaway_loop_threshold: 10,
    price_table_version: "",
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();

    switch (key) {
      case "per_agent_budget": {
        const n = Number(value);
        out.per_agent_budget = Number.isFinite(n) ? n : Infinity;
        break;
      }
      case "runaway_loop_threshold": {
        const n = Number(value);
        out.runaway_loop_threshold = Number.isFinite(n) ? n : 10;
        break;
      }
      case "price_table_version": {
        // 去除可能的引号
        out.price_table_version = value.replace(/^["']|["']$/g, "");
        break;
      }
      default:
        // 未知字段忽略（向前兼容）
        break;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

export interface CreateBudgetPolicyOpts {
  configPath?: string;
  projectScopePath?: string;
  getSpent?: (sessionId: string, agentId: string) => number;
}

export function createBudgetPolicy(
  opts: CreateBudgetPolicyOpts = {},
): BudgetPolicy {
  // 未传 configPath 时默认指向 bundled 默认 scope budget_policy.yaml
  // （git-versioned config 层，而非随二进制发布的 TS 常量）。
  const configPath = opts.configPath ?? DEFAULT_BUDGET_POLICY_PATH;
  const projectScopePath = opts.projectScopePath;
  const getSpent = opts.getSpent ?? (() => 0);

  return {
    load(): BudgetConfig {
      // 项目 scope 覆写 → 硬拒（不 merge with warning）
      if (projectScopePath !== undefined) {
        throw new ProjectScopeOverrideRejectedError();
      }
      const content = readFileSync(configPath, "utf8");
      return parseBudgetYaml(content);
    },

    checkBudget(sessionId: string, agentId: string): {
      exceeded: boolean;
      spent: number;
      limit: number;
    } {
      const cfg = this.load();
      const spent = getSpent(sessionId, agentId);
      const limit = cfg.per_agent_budget;
      const exceeded = spent > limit; // 严格大于
      return { exceeded, spent, limit };
    },

    detectRunaway(recentToolCalls: ToolCall[]): {
      runaway: boolean;
      toolName: string | null;
      count: number;
    } {
      const cfg = this.load();
      const threshold = cfg.runaway_loop_threshold;

      // 遍历，计算最大连续同 toolName 调用次数
      let maxRun = 0;
      let maxRunTool: string | null = null;
      let currentRun = 0;
      let currentTool: string | null = null;

      for (const call of recentToolCalls) {
        const name = call.toolName;
        if (currentTool === null) {
          currentTool = name;
          currentRun = 1;
        } else if (name === currentTool) {
          currentRun += 1;
        } else {
          // 打断
          if (currentRun > maxRun) {
            maxRun = currentRun;
            maxRunTool = currentTool;
          }
          currentTool = name;
          currentRun = 1;
        }
      }
      // 收尾
      if (currentRun > maxRun) {
        maxRun = currentRun;
        maxRunTool = currentTool;
      }
      // 空数组 → maxRun=0, maxRunTool=null
      if (recentToolCalls.length === 0) {
        maxRun = 0;
        maxRunTool = null;
      }

      const runaway = maxRun > threshold; // 严格大于
      return { runaway, toolName: maxRunTool, count: maxRun };
    },

    assertMutableByAgent(): void {
      const role = process.env["SEH_ROLE"];
      if (role === "agent") {
        throw new RewardTamperingError();
      }
    },
  };
}
