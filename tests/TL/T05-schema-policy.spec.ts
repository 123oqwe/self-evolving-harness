// TL-T05: telemetry schema 写策略 config（项目 scope 不可覆写 + 无 PII）
//
// 覆盖 spec（execution/telemetry/TASKS.md §TL-T05）的 Given/When/Then 全部场景：
//   1. 默认 config → load() 返回默认 config（truncate_bytes=50000 等）
//   2. 项目 scope 覆写 → load(projectScopePath) 抛 ProjectScopeOverrideRejectedError
//   3. PII 字段 full_env_vars → validate 报 piiFields:['full_env_vars']
//   4. telemetry_schema_frozen=true → 改 config 抛 SchemaFrozenError
//   5. truncate_bytes < 1024 → validate 报 violations（1KB 下限锁）
//   6. applyToWriter: capture_thinking_blocks=false → writer 跳过 thinking blocks 不落盘
//
// RED state: 模块尚未实现，从 `@harness/telemetry` 的 import 会失败 —— 这是合法 RED。
// 实现 GREEN 后，下列断言须真正检验行为。
//
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSchemaPolicy } from "@harness/telemetry";
import type {
  SchemaPolicy,
  SchemaConfig,
  TranscriptWriter,
  TranscriptNode,
  NormalizedContent,
} from "@harness/telemetry";
import {
  ProjectScopeOverrideRejectedError,
  SchemaFrozenError,
} from "@harness/telemetry";

// ---------------------------------------------------------------------------
// 辅助构造器
//
// 说明：spec 给出 SchemaConfig 公共类型（schema_version/required_fields[]/
// truncate_bytes/capture_thinking_blocks/sample_non_llm_spans/
// telemetry_schema_frozen?）与 SchemaPolicy 公共接口（load/validate/applyToWriter）。
// `createSchemaPolicy` 工厂函数未在 spec 显式给出签名，但与 T01 的
// `createTranscriptWriter` 同模式；此处允许注入 `defaultConfigPath` 以便用临时
// 默认 config 驱动 frozen 测试（见文末 ambiguities）。
//
// `NormalizedContent`（TranscriptNode.content）spec 仅述"text/image 归一化"，
// 未给精确形状。此处按最小可工作假设构造：content 为 block 数组，block 形如
// `{ type:'thinking', thinking:string }` 或 `{ type:'text', text:string }`。
// ---------------------------------------------------------------------------

/** 构造一个合法的基础 SchemaConfig（无 PII、truncate 合规、未冻结）。 */
function baseConfig(over: Partial<SchemaConfig> = {}): SchemaConfig {
  return {
    schema_version: "v1",
    required_fields: ["type", "uuid", "parentUuid", "sessionId", "content"],
    truncate_bytes: 50000,
    capture_thinking_blocks: true,
    sample_non_llm_spans: 1.0,
    ...over,
  };
}

/** content block：thinking 块（assistant 推理内容）。 */
function thinkingBlock(text: string): unknown {
  return { type: "thinking", thinking: text };
}

/** content block：text 块。 */
function textBlock(text: string): unknown {
  return { type: "text", text };
}

/** 把 block 数组包成 NormalizedContent（类型未知，用 unknown 转换）。 */
function blocksContent(blocks: unknown[]): NormalizedContent {
  return blocks as unknown as NormalizedContent;
}

/**
 * 假 TranscriptWriter：记录所有 append 进来的节点，用于断言 applyToWriter 后
 * writer 实际落盘的内容（是否还含 thinking blocks）。
 *
 * applyToWriter 的精确机制（包裹 append / 设置内部 flag）spec 未定义；此处假设
 * applyToWriter 会在 capture_thinking_blocks=false 时改造 writer.append，使传进来
 * 的 content 在落盘前被剥离 thinking 块。fake writer 的 append 记录最终落盘值。
 * 见文末 ambiguities。
 */
class FakeWriter implements TranscriptWriter {
  appended: Array<Partial<TranscriptNode>> = [];

  async startSession(_ctx: {
    cwd: string;
    gitBranch: string;
    version: string;
  }): Promise<string> {
    return "fake-session";
  }

  async append(
    node: Omit<TranscriptNode, "uuid" | "parentUuid" | "timestamp"> & {
      parentUuid: string | null;
    },
  ): Promise<string> {
    // 记录实际落盘的内容快照（深拷贝以防后续 mutate）
    this.appended.push(JSON.parse(JSON.stringify(node)));
    return `fake-uuid-${this.appended.length}`;
  }

  async appendSubagentBoundary(
    _parentUuid: string,
    _agentId: string,
  ): Promise<string> {
    return "fake-boundary-uuid";
  }

  async loadSession(_sessionId: string): Promise<TranscriptNode[]> {
    return [];
  }

  verifyTree(_nodes: TranscriptNode[]): { ok: boolean; orphans: string[] } {
    return { ok: true, orphans: [] };
  }
}

// ---------------------------------------------------------------------------
// TL-T05
// ---------------------------------------------------------------------------
describe("TL-T05", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tl-t05-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 场景 1：load 默认 config 成功
  //   Given 默认 config truncate_bytes=50000
  //   When  load()（无 project scope）
  //   Then  返回默认 config
  // -------------------------------------------------------------------------
  it("load 默认 config 成功", () => {
    const policy = createSchemaPolicy();
    const cfg = policy.load();

    // 断言默认 config 的关键字段，而非空 toBeDefined
    expect(cfg.schema_version).toEqual(expect.any(String));
    expect(cfg.schema_version.length).toBeGreaterThan(0);
    expect(cfg.truncate_bytes).toBe(50000);
    expect(cfg.capture_thinking_blocks).toEqual(expect.any(Boolean));
    expect(cfg.sample_non_llm_spans).toBeGreaterThanOrEqual(0);
    expect(cfg.sample_non_llm_spans).toBeLessThanOrEqual(1);
    expect(Array.isArray(cfg.required_fields)).toBe(true);
    expect(cfg.required_fields.length).toBeGreaterThan(0);
    // 默认未冻结
    expect(cfg.telemetry_schema_frozen ?? false).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 场景 2：项目 scope 覆写 → ProjectScopeOverrideRejectedError
  //   Given project scope 试图覆写 telemetry_schema_config.json
  //   When  load(projectScopePath)
  //   Then  抛 ProjectScopeOverrideRejectedError（硬拒，不 merge with warning）
  // -------------------------------------------------------------------------
  it("项目 scope 覆写 → ProjectScopeOverrideRejectedError", () => {
    const policy = createSchemaPolicy();
    const projectScopePath = join(tmpDir, "telemetry_schema_config.json");
    writeFileSync(
      projectScopePath,
      JSON.stringify({ ...baseConfig(), truncate_bytes: 9999 }),
    );

    expect(() => policy.load(projectScopePath)).toThrow(
      ProjectScopeOverrideRejectedError,
    );
    // 进一步断言错误信息含 scope/覆写语义（防实现只抛通用 Error）
    expect(() => policy.load(projectScopePath)).toThrow(
      /scope|override|覆写/i,
    );
  });

  // -------------------------------------------------------------------------
  // 场景 3：PII 字段 full_env_vars → validate 报 piiFields
  //   Given config 含 PII 字段（如 full_env_vars）
  //   When  validate
  //   Then  { ok:false, piiFields:['full_env_vars'] }
  // -------------------------------------------------------------------------
  it("PII 字段 full_env_vars → validate 报 piiFields", () => {
    const policy = createSchemaPolicy();
    const cfg = baseConfig({
      required_fields: [
        "type",
        "uuid",
        "parentUuid",
        "sessionId",
        "content",
        "full_env_vars", // PII denylist 命中
      ],
    });

    const result = policy.validate(cfg);

    expect(result.ok).toBe(false);
    expect(result.piiFields).toContain("full_env_vars");
    // violations 与 piiFields 分开，PII 命中不算 truncate 类违规
    expect(result.violations).toEqual(expect.any(Array));
  });

  // -------------------------------------------------------------------------
  // 场景 4：telemetry_schema_frozen=true → 改 config 抛 SchemaFrozenError
  //   Given telemetry_schema_frozen=true（用户/managed scope 锁定）
  //   When  任何试图改 config 的调用（此处：load(projectScopePath)）
  //   Then  抛 SchemaFrozenError
  //
  // 说明：spec 未明确“改 config 的调用”映射到哪个方法。SchemaPolicy 公开方法仅
  // load/validate/applyToWriter，load(projectScopePath) 是唯一“带覆盖意图”的写式
  // 入口；此处用注入 frozen=true 的默认 config 驱动。见文末 ambiguities。
  // -------------------------------------------------------------------------
  it("telemetry_schema_frozen=true → 改 config 抛 SchemaFrozenError", () => {
    // 注入 frozen=true 的默认 config
    const frozenDefaultPath = join(tmpDir, "frozen_default.json");
    writeFileSync(
      frozenDefaultPath,
      JSON.stringify({ ...baseConfig(), telemetry_schema_frozen: true }),
    );
    const policy = createSchemaPolicy({ defaultConfigPath: frozenDefaultPath });

    const projectScopePath = join(tmpDir, "telemetry_schema_config.json");
    writeFileSync(
      projectScopePath,
      JSON.stringify({ ...baseConfig(), truncate_bytes: 9999 }),
    );

    // 冻结态下，任何改 config 的尝试（含 project scope 覆写）抛 SchemaFrozenError
    expect(() => policy.load(projectScopePath)).toThrow(SchemaFrozenError);
  });

  // -------------------------------------------------------------------------
  // 场景 5：truncate_bytes < 1024 → validate 报违规
  //   Given config truncate_bytes < 1024
  //   When  validate
  //   Then  { ok:false, violations:['truncate_bytes below 1KB floor'] }
  // -------------------------------------------------------------------------
  it("truncate_bytes < 1024 → validate 报违规", () => {
    const policy = createSchemaPolicy();
    const cfg = baseConfig({ truncate_bytes: 512 }); // 低于 1KB 下限

    const result = policy.validate(cfg);

    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    // 命中下限锁的违规信息（防实现用通用 message 蒙混）
    expect(
      result.violations.some((v) => /truncate_bytes|1KB|floor|below/i.test(v)),
    ).toBe(true);
    // 该 cfg 无 PII 字段，piiFields 应为空
    expect(result.piiFields).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 场景 6：applyToWriter: capture_thinking_blocks=false 跳过 thinking
  //   Given config capture_thinking_blocks=false
  //   When  applyToWriter
  //   Then  writer 跳过 thinking blocks 不落盘
  // -------------------------------------------------------------------------
  it("applyToWriter: capture_thinking_blocks=false 跳过 thinking", async () => {
    const policy = createSchemaPolicy();
    const writer = new FakeWriter();
    const cfgOff = baseConfig({ capture_thinking_blocks: false });

    policy.applyToWriter(cfgOff, writer);

    // append 一个含 thinking + text 的 assistant 节点
    const sessionId = "sess-1";
    await writer.append({
      type: "assistant",
      parentUuid: null,
      sessionId,
      cwd: "/tmp/proj",
      gitBranch: "main",
      version: "0.1.0",
      content: blocksContent([
        thinkingBlock("internal reasoning that must not persist"),
        textBlock("the actual answer"),
      ]),
    });

    expect(writer.appended).toHaveLength(1);
    const recorded = writer.appended[0]!;
    const recordedBlocks = (recorded as { content: unknown }).content as unknown[];
    // thinking 块被剥离：只剩 text 块
    const hasThinking = recordedBlocks.some(
      (b) => (b as { type?: string }).type === "thinking",
    );
    expect(hasThinking).toBe(false);
    expect(
      recordedBlocks.some((b) => (b as { type?: string }).type === "text"),
    ).toBe(true);
    // text 内容保留
    expect(
      recordedBlocks.some(
        (b) =>
          (b as { type?: string }).type === "text" &&
          (b as { text?: string }).text === "the actual answer",
      ),
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 补充：capture_thinking_blocks=true 时 thinking 块保留（对照场景 6）
  // -------------------------------------------------------------------------
  it("applyToWriter: capture_thinking_blocks=true 保留 thinking", async () => {
    const policy = createSchemaPolicy();
    const writer = new FakeWriter();
    const cfgOn = baseConfig({ capture_thinking_blocks: true });

    policy.applyToWriter(cfgOn, writer);

    await writer.append({
      type: "assistant",
      parentUuid: null,
      sessionId: "sess-2",
      cwd: "/tmp/proj",
      gitBranch: "main",
      version: "0.1.0",
      content: blocksContent([
        thinkingBlock("internal reasoning"),
        textBlock("answer"),
      ]),
    });

    const recorded = writer.appended[0]!;
    const recordedBlocks = (recorded as { content: unknown }).content as unknown[];
    expect(
      recordedBlocks.some((b) => (b as { type?: string }).type === "thinking"),
    ).toBe(true);
  });
});
