// TL-T06: budget_policy + runaway-loop detector（连续同工具调用 → abort）
//
// 覆盖 spec（execution/telemetry/TASKS.md §TL-T06）的 Given/When/Then 全部场景：
//   1. 连续 11 次 bash（无穿插） → detectRunaway 返回 {runaway:true, toolName:'bash', count:11}
//   2. 10 次 bash + 1 次 read + 10 次 bash（穿插打断计数） → {runaway:false}
//   3. session 已花 token > per_agent_budget → checkBudget 返回 {exceeded:true, ...} 触发 abort
//   4. agent 运行时进程调 assertMutableByAgent → 抛 RewardTamperingError
//   5. budget_policy.yaml 被 project scope 覆写 → load 抛 ProjectScopeOverrideRejectedError
//
// RED state: 模块尚未实现，从 `@harness/telemetry` 的 import 会失败 —— 这是合法 RED。
// 实现 GREEN 后，下列断言须真正检验行为。
//
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBudgetPolicy } from "@harness/telemetry";
import type {
  BudgetPolicy,
  BudgetConfig,
  ToolCall,
} from "@harness/telemetry";
import {
  RewardTamperingError,
  ProjectScopeOverrideRejectedError,
} from "@harness/telemetry";

// ---------------------------------------------------------------------------
// 辅助构造器
//
// 说明：spec 仅给出 `BudgetPolicy` 接口与 `BudgetConfig`/`ToolCall` 类型，未定义
// 具体实现类/工厂名，也未定义构造期依赖注入（DI）的形状。此处按最小可工作假设：
//   - 用工厂 `createBudgetPolicy(opts)` 取得 `BudgetPolicy` 实例；
//   - opts.configPath 指向默认 scope 的 budget_policy.yaml（git-versioned）；
//   - opts.projectScopePath 指向项目 scope 覆写文件（须被 reject）；
//   - opts.getSpent 提供 per-(sessionId,agentId) 已花 token 数（来自 TL-T02 cost 累计），
//     供 checkBudget 在内部查询 spent。
// 这些 DI 细节是 spec 缺口，见文末 ambiguities。
// ---------------------------------------------------------------------------

// 构造一个连续同工具调用的 recentToolCalls 序列
function calls(toolName: string, n: number): ToolCall[] {
  return Array.from({ length: n }, () => ({ toolName }) as ToolCall);
}

// 默认 budget_policy.yaml 内容（threshold=10, per_agent_budget=1_000_000, price v1）
function defaultYaml(): string {
  return [
    "per_agent_budget: 1000000",
    "runaway_loop_threshold: 10",
    "price_table_version: v1",
  ].join("\n");
}

// project scope 覆写 yaml（试图放宽阈值 → reward tampering 向）
function overrideYaml(): string {
  return [
    "per_agent_budget: 100000000",
    "runaway_loop_threshold: 1000",
    "price_table_version: v1",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// TL-T06
// ---------------------------------------------------------------------------
describe("TL-T06", () => {
  let baseDir: string;
  let defaultCfgPath: string;
  let projectScopePath: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "tl-t06-"));
    defaultCfgPath = join(baseDir, "budget_policy.yaml");
    projectScopePath = join(baseDir, "project-budget_policy.yaml");
    writeFileSync(defaultCfgPath, defaultYaml(), "utf8");
    writeFileSync(projectScopePath, overrideYaml(), "utf8");
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  // 保存/恢复 SEH_ROLE 环境变量（assertMutableByAgent 依赖它判定进程角色）
  let savedRole: string | undefined;
  beforeEach(() => {
    savedRole = process.env["SEH_ROLE"];
    delete process.env["SEH_ROLE"];
  });
  afterEach(() => {
    if (savedRole === undefined) {
      delete process.env["SEH_ROLE"];
    } else {
      process.env["SEH_ROLE"] = savedRole;
    }
  });

  // -------------------------------------------------------------------------
  // 场景 1 + RED 名: "runaway: 连续 11 次 bash → runaway=true"
  //   Given runaway_loop_threshold=10，agent 连续调用 bash 11 次（无其他工具穿插）
  //   When  detectRunaway
  //   Then  {runaway:true, toolName:'bash', count:11}
  // -------------------------------------------------------------------------
  it("runaway: 连续 11 次 bash → runaway=true", () => {
    const policy = createBudgetPolicy({
      configPath: defaultCfgPath,
      getSpent: () => 0,
    });
    // load 以初始化内部 config（threshold 来自 yaml）
    const cfg = policy.load();
    expect(cfg.runaway_loop_threshold).toBe(10);

    const recent = calls("bash", 11);
    const result = policy.detectRunaway(recent);

    expect(result.runaway).toBe(true);
    expect(result.toolName).toBe("bash");
    // count = 实际连续同工具调用次数（11），严格大于 threshold(10) → 触发
    expect(result.count).toBe(11);
  });

  // -------------------------------------------------------------------------
  // 场景 2 + RED 名: "runaway: 穿插 read 打断计数 → runaway=false"
  //   Given 10 次 bash 后穿插 1 次 read 再 10 次 bash
  //   When  detectRunaway
  //   Then  {runaway:false}（穿插打断计数；最大连续 run=10，不严格大于 threshold=10）
  // -------------------------------------------------------------------------
  it("runaway: 穿插 read 打断计数 → runaway=false", () => {
    const policy = createBudgetPolicy({
      configPath: defaultCfgPath,
      getSpent: () => 0,
    });
    policy.load();

    // 10 bash + 1 read + 10 bash → 任何连续 run 均为 10，不严格大于 threshold=10
    const recent: ToolCall[] = [
      ...calls("bash", 10),
      ...calls("read", 1),
      ...calls("bash", 10),
    ];
    const result = policy.detectRunaway(recent);

    expect(result.runaway).toBe(false);
    // 未触发时 count 必须落在阈值以内（最大连续 run ≤ threshold）
    expect(result.count).toBeLessThanOrEqual(10);
  });

  // -------------------------------------------------------------------------
  // 场景 3 + RED 名: "budget: 超 per_agent_budget → exceeded=true"
  //   Given per_agent_budget=1_000_000，session 已花 1_100_000 token
  //   When  checkBudget(sessionId, agentId)
  //   Then  {exceeded:true, spent:1_100_000, limit:1_000_000} → 触发 abort
  // -------------------------------------------------------------------------
  it("budget: 超 per_agent_budget → exceeded=true", () => {
    const sessionId = "sess-over";
    const agentId = "parent-A";
    const policy = createBudgetPolicy({
      configPath: defaultCfgPath,
      // 模拟 TL-T02 cost 累计：该 (session,agent) 已花 1_100_000 token
      getSpent: (sid: string, aid: string) =>
        sid === sessionId && aid === agentId ? 1_100_000 : 0,
    });
    const cfg = policy.load();
    expect(cfg.per_agent_budget).toBe(1_000_000);

    const result = policy.checkBudget(sessionId, agentId);

    expect(result.exceeded).toBe(true);
    expect(result.spent).toBe(1_100_000);
    expect(result.limit).toBe(1_000_000);
    // exceeded 语义：spent 严格大于 limit
    expect(result.spent).toBeGreaterThan(result.limit);
  });

  // -------------------------------------------------------------------------
  // 边界补充：未超预算 → exceeded=false（与场景 3 互补，固化 abort 触发条件）
  //   Given per_agent_budget=1_000_000，session 已花 500_000 token（< limit）
  //   When  checkBudget
  //   Then  {exceeded:false, spent:500_000, limit:1_000_000}
  // -------------------------------------------------------------------------
  it("budget: 未超 per_agent_budget → exceeded=false", () => {
    const sessionId = "sess-ok";
    const agentId = "parent-A";
    const policy = createBudgetPolicy({
      configPath: defaultCfgPath,
      getSpent: () => 500_000,
    });
    policy.load();

    const result = policy.checkBudget(sessionId, agentId);

    expect(result.exceeded).toBe(false);
    expect(result.spent).toBe(500_000);
    expect(result.limit).toBe(1_000_000);
  });

  // -------------------------------------------------------------------------
  // 场景 4 + RED 名: "agent 运行时改 budget → RewardTamperingError"
  //   Given agent 运行时进程（SEH_ROLE=agent）调 assertMutableByAgent
  //   When  assertMutableByAgent
  //   Then  抛 RewardTamperingError（agent 不可运行时改预算/runaway 阈值）
  // -------------------------------------------------------------------------
  it("agent 运行时改 budget → RewardTamperingError", () => {
    const policy = createBudgetPolicy({
      configPath: defaultCfgPath,
      getSpent: () => 0,
    });

    // 非 agent 进程（SEH_ROLE 未设）：可变校验应放行（不抛）
    expect(() => policy.assertMutableByAgent()).not.toThrow();

    // 标记为 agent 运行时进程 → 任何试图改 budget 的调用须被拒
    process.env["SEH_ROLE"] = "agent";
    expect(() => policy.assertMutableByAgent()).toThrowError(
      RewardTamperingError,
    );
  });

  // -------------------------------------------------------------------------
  // 场景 5 + RED 名: "project scope 覆写 → reject"
  //   Given budget_policy.yaml 被 project scope 覆写（projectScopePath 指向覆写文件）
  //   When  load
  //   Then  抛 ProjectScopeOverrideRejectedError（项目 scope 不可覆写 *_policy.yaml）
  // -------------------------------------------------------------------------
  it("project scope 覆写 → reject", () => {
    // 默认 scope（无 projectScopePath）：load 须成功并返回 yaml 内容
    const cleanPolicy = createBudgetPolicy({
      configPath: defaultCfgPath,
      getSpent: () => 0,
    });
    const cfg = cleanPolicy.load();
    expect(cfg.per_agent_budget).toBe(1_000_000);
    expect(cfg.runaway_loop_threshold).toBe(10);
    expect(cfg.price_table_version).toBe("v1");

    // 项目 scope 覆写 → load 须硬拒（不 merge with warning）
    const overriddenPolicy = createBudgetPolicy({
      configPath: defaultCfgPath,
      projectScopePath,
      getSpent: () => 0,
    });
    expect(() => overriddenPolicy.load()).toThrowError(
      ProjectScopeOverrideRejectedError,
    );
  });

  // -------------------------------------------------------------------------
  // 边界补充：runaway 阈值边界——恰好等于 threshold 的连续调用不触发
  //   Given runaway_loop_threshold=10，连续 10 次 bash（== threshold，非严格大于）
  //   When  detectRunaway
  //   Then  {runaway:false}（abort 须在严格超过时触发，避免阈值边界误杀）
  // -------------------------------------------------------------------------
  it("runaway: 连续恰好 threshold 次 bash 不触发（边界）", () => {
    const policy = createBudgetPolicy({
      configPath: defaultCfgPath,
      getSpent: () => 0,
    });
    policy.load();

    const result = policy.detectRunaway(calls("bash", 10));
    expect(result.runaway).toBe(false);
  });
});
