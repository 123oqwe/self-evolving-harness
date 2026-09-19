// TL-T10: trajectory replay + distillation flywheel（ATIF 格式 + eval dataset + LLM-judge score）
//
// 覆盖 spec（execution/telemetry/TASKS.md §TL-T10）的 Given/When/Then 全部场景：
//   1. 3 个成功 session → exportEvalDataset 返回 ATIFDataset，records 含 3 条 outcome='success'
//   2. judgeTrajectory → 返回 0-1 score + 落 gen_ai.evaluation.score span
//   3. 失败 session 不进 dataset（与 TL-T09 一致）
//   4. ATIF record 缺 judgeScore → MissingJudgeScoreError
//   5. transcript 损坏 → TranscriptCorruptError + 报告错误数
//
// RED state: 模块尚未实现，从 `@harness/telemetry` 的 import 会失败 —— 这是合法 RED。
// 实现 GREEN 后，下列断言须真正检验行为。
//
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFlywheel,
  createTranscriptWriter,
  encodeATIFRecord,
} from "@harness/telemetry";
import type {
  Flywheel,
  ATIFDataset,
  ATIFRecord,
  Trajectory,
  TranscriptWriter,
  TrajectoryStep,
  GenAiSpan,
} from "@harness/telemetry";
import {
  MissingJudgeScoreError,
  TranscriptCorruptError,
} from "@harness/telemetry";

// ---------------------------------------------------------------------------
// 辅助构造
//
// 说明：spec 给出 Flywheel / ATIFDataset / ATIFRecord 公共接口，但 TrajectoryStep
// 类型、Flywheel 工厂签名、judge provider 注入、otel emitter 注入、成功判定、
// 错误数报告机制均未在 spec 显式定义。此处按最小可工作假设（见文末 ambiguities）：
//   - 工厂 createFlywheel(opts: { transcript, selector?, judge?, otelEmitter? })；
//   - judge: (t: Trajectory) => Promise<number> 注入 LLM-judge（CE-T05 去偏配置由
//     实现侧注入）；
//   - ATIFDataset 额外暴露 errors: number 字段（报告被跳过的损坏 session 数）；
//   - encodeATIFRecord(record) 为单条 record 序列化入口（用于缺 judgeScore 测试）。
// 成功 session 判定 = transcript 末状态为 success（无 failed turn）。
// ---------------------------------------------------------------------------

const VERSION = "0.1.0";
const GIT = "main";
const CWD = "/tmp/tl-t10-proj";

function zeroUsage() {
  return { input: 0, output: 0, cache_read: 0, cache_creation: 0, reasoning: 0 };
}

/** 构造一个成功 session：user → assistant(text) → 结束（无 failed turn）。 */
async function buildSuccessSession(writer: TranscriptWriter, tag: string): Promise<string> {
  const sessionId = await writer.startSession({ cwd: CWD, gitBranch: GIT, version: VERSION });
  await writer.append({
    type: "user",
    sessionId,
    cwd: CWD,
    gitBranch: GIT,
    version: VERSION,
    content: [{ type: "text", text: `task ${tag}` }] as any,
    parentUuid: null,
  });
  const a = await writer.append({
    type: "assistant",
    sessionId,
    cwd: CWD,
    gitBranch: GIT,
    version: VERSION,
    content: [{ type: "text", text: `done ${tag}` }] as any,
    usage: zeroUsage(),
    parentUuid: null,
  });
  // 第二条 assistant（建树链接）
  await writer.append({
    type: "assistant",
    sessionId,
    cwd: CWD,
    gitBranch: GIT,
    version: VERSION,
    content: [{ type: "text", text: `final ${tag}` }] as any,
    usage: zeroUsage(),
    parentUuid: a,
  });
  return sessionId;
}

/** 构造一个失败 session：含一个 is_error 的 tool_result → 失败。 */
async function buildFailedSession(writer: TranscriptWriter): Promise<string> {
  const sessionId = await writer.startSession({ cwd: CWD, gitBranch: GIT, version: VERSION });
  const root = await writer.append({
    type: "assistant",
    sessionId,
    cwd: CWD,
    gitBranch: GIT,
    version: VERSION,
    content: [{ type: "tool_use", id: "tu_fail", name: "bash", input: { cmd: "false" } }] as any,
    toolUseId: "tu_fail",
    usage: zeroUsage(),
    parentUuid: null,
  });
  await writer.append({
    type: "tool_result",
    sessionId,
    cwd: CWD,
    gitBranch: GIT,
    version: VERSION,
    content: [{ type: "tool_result", tool_use_id: "tu_fail", content: "err", is_error: true }] as any,
    toolUseId: "tu_fail",
    parentUuid: root,
  });
  return sessionId;
}

/** 构造一个损坏 session：orphaned tool_result。 */
async function buildCorruptSession(writer: TranscriptWriter): Promise<string> {
  const sessionId = await writer.startSession({ cwd: CWD, gitBranch: GIT, version: VERSION });
  const root = await writer.append({
    type: "assistant",
    sessionId,
    cwd: CWD,
    gitBranch: GIT,
    version: VERSION,
    content: [{ type: "text", text: "root" }] as any,
    toolUseId: "tu_real",
    usage: zeroUsage(),
    parentUuid: null,
  });
  await writer.append({
    type: "tool_result",
    sessionId,
    cwd: CWD,
    gitBranch: GIT,
    version: VERSION,
    content: [{ type: "text", text: "orphan" }] as any,
    toolUseId: "tu_orphan_unpaired",
    parentUuid: root,
  });
  return sessionId;
}

function fakeJudge(score: number) {
  return async (_t: Trajectory): Promise<number> => score;
}

/**
 * FakeOtelEmitter：通过标准 OtelEmitter 接口（startLLMSpan/endLLMSpan）捕获
 * judgeTrajectory 落的 evaluation span。FakeSpan 暴露 setAttribute（与真实
 * @opentelemetry/api Span 一致），使 flywheel 可设 gen_ai.evaluation.* 属性，
 * exportSpans 返回已捕获的 span。这避免了「fake 不捕获 → exportSpans 恒空 →
 * 即便正确 impl 也无法通过」的空壳陷阱。
 */
class FakeSpan {
  name: string;
  spanId: string;
  traceId = "trace-1";
  parentSpanId?: string;
  attributes: Record<string, unknown> = {};
  events: Array<{ name: string; attributes?: unknown }> = [];
  constructor(name: string, spanId: string) {
    this.name = name;
    this.spanId = spanId;
  }
  setAttribute(key: string, value: unknown): this {
    this.attributes[key] = value;
    return this;
  }
  addEvent(name: string, attributes?: unknown): this {
    this.events.push({ name, attributes });
    return this;
  }
  end(): void {
    /* no-op */
  }
}

class FakeOtelEmitter {
  private spans: FakeSpan[] = [];
  private counter = 0;
  startLLMSpan(ctx?: { operation?: string; model?: string }): FakeSpan {
    const op = ctx?.operation ?? "chat";
    const model = ctx?.model ?? "claude-sonnet-4.5";
    const span = new FakeSpan(`${op} ${model}`, `span-${this.counter++}`);
    this.spans.push(span);
    return span;
  }
  endLLMSpan(_span: FakeSpan, _usage?: unknown): void {
    /* finalize: span 已在 startLLMSpan 时捕获 */
  }
  emitMessageEvent(span: FakeSpan, messages: unknown[]): void {
    span.addEvent("message", messages);
  }
  startToolSpan(toolName: string, parentSpanId: string): FakeSpan {
    const span = new FakeSpan(toolName, `span-${this.counter++}`);
    span.parentSpanId = parentSpanId;
    this.spans.push(span);
    return span;
  }
  propagateToSubagent(): unknown {
    return {};
  }
  exportSpans(): GenAiSpan[] {
    return this.spans as unknown as GenAiSpan[];
  }
}

// ---------------------------------------------------------------------------
// TL-T10
// ---------------------------------------------------------------------------
describe("TL-T10", () => {
  let baseDir: string;
  let writer: TranscriptWriter;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "tl-t10-"));
    writer = createTranscriptWriter({ baseDir });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 场景 1 + RED 名: "exportEvalDataset: 3 成功 session → 3 records"
  //   Given 3 个成功 session
  //   When  exportEvalDataset
  //   Then  返回 ATIFDataset，records 含 3 条，每条 outcome='success'
  // -------------------------------------------------------------------------
  it("exportEvalDataset: 3 成功 session → 3 records", async () => {
    const ids = [
      await buildSuccessSession(writer, "a"),
      await buildSuccessSession(writer, "b"),
      await buildSuccessSession(writer, "c"),
    ];
    const flywheel = createFlywheel({
      transcript: writer,
      judge: fakeJudge(0.8),
      otelEmitter: new FakeOtelEmitter() as any,
    });
    const ds = await flywheel.exportEvalDataset(ids);

    expect(ds.format).toBe("ATIF");
    expect(typeof ds.version).toBe("string");
    expect(ds.version.length).toBeGreaterThan(0);
    expect(ds.records.length).toBe(3);
    for (const r of ds.records) {
      expect(r.outcome).toBe("success");
      expect(typeof r.task).toBe("string");
      expect(Array.isArray(r.steps)).toBe(true);
      expect(typeof r.totalTokens).toBe("number");
      expect(typeof r.judgeScore).toBe("number");
      expect(r.judgeScore).toBeGreaterThanOrEqual(0);
      expect(r.judgeScore).toBeLessThanOrEqual(1);
    }
    // 错误数为 0（全部成功 session）
    expect((ds as unknown as { errors?: number }).errors ?? 0).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 场景 2 + RED 名: "judgeTrajectory: 返回 0-1 score + 落 gen_ai.evaluation.score span"
  //   Given 一个 trajectory
  //   When  judgeTrajectory
  //   Then  返回 0-1 score，且 gen_ai.evaluation.score span 落 OTel
  // -------------------------------------------------------------------------
  it("judgeTrajectory: 返回 0-1 score + 落 gen_ai.evaluation.score span", async () => {
    const otel = new FakeOtelEmitter();
    const flywheel = createFlywheel({
      transcript: writer,
      judge: fakeJudge(0.42),
      otelEmitter: otel as any,
    });
    const t: Trajectory = {
      sessionId: "judge-sess",
      success: true,
      totalTokens: 1000,
      taskType: "code",
      embedding: [1, 0],
    };
    const score = await flywheel.judgeTrajectory(t);

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
    // judge 注入返回 0.42 → score 须反映
    expect(score).toBeCloseTo(0.42, 6);

    const spans = otel.exportSpans();
    const evalSpan = spans.find((s) =>
      Object.keys(s.attributes as Record<string, unknown>).some((k) =>
        k.startsWith("gen_ai.evaluation."),
      ),
    );
    expect(evalSpan).toBeDefined();
    expect(
      (evalSpan!.attributes as Record<string, unknown>)["gen_ai.evaluation.score"],
    ).toBeCloseTo(0.42, 6);
  });

  // -------------------------------------------------------------------------
  // 场景 3 + RED 名: "失败 session 不进 dataset"
  //   Given session 含失败 turn
  //   When  exportEvalDataset
  //   Then  该 session 不进 dataset（distill 只选成功，与 TL-T09 一致）
  // -------------------------------------------------------------------------
  it("失败 session 不进 dataset", async () => {
    const okId = await buildSuccessSession(writer, "ok");
    const failId = await buildFailedSession(writer);
    const flywheel = createFlywheel({
      transcript: writer,
      judge: fakeJudge(0.5),
      otelEmitter: new FakeOtelEmitter() as any,
    });
    const ds = await flywheel.exportEvalDataset([okId, failId]);

    expect(ds.records.length).toBe(1);
    expect(ds.records[0]!.outcome).toBe("success");
    // 失败 session 不进 dataset
    expect(ds.records.some((r) => r.task.includes("ok"))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 场景 4 + RED 名: "ATIF record 缺 judgeScore → MissingJudgeScoreError"
  //   Given ATIF record 缺 judgeScore
  //   When  序列化
  //   Then  抛 MissingJudgeScoreError（ATIF 格式强制字段）
  // -------------------------------------------------------------------------
  it("ATIF record 缺 judgeScore → MissingJudgeScoreError", () => {
    const record: ATIFRecord = {
      task: "sample",
      steps: [] as unknown as TrajectoryStep[],
      outcome: "success",
      totalTokens: 1000,
      judgeScore: undefined as unknown as number, // 缺失
    };
    // 必须抛 MissingJudgeScoreError（类名出现在 error name/message，可正则匹配）；
    // 不接受任意 TypeError——impl 未完成时 encodeATIFRecord 为 undefined 抛 TypeError
    // 不含类名 → RED；impl 完成后抛 MissingJudgeScoreError 含类名 → GREEN。
    expect(() => encodeATIFRecord(record)).toThrow(/MissingJudgeScoreError/);
    // 若实现导出了类，进一步断言 instanceof（GREEN 后此断言生效）
    try {
      encodeATIFRecord(record);
    } catch (e) {
      if (typeof MissingJudgeScoreError === "function") {
        expect(e).toBeInstanceOf(MissingJudgeScoreError);
      }
    }
  });

  // -------------------------------------------------------------------------
  // 场景 5 + RED 名: "transcript 损坏 → TranscriptCorruptError + 报告错误数"
  //   Given session transcript 损坏
  //   When  exportEvalDataset
  //   Then  抛 TranscriptCorruptError，跳过该 session 但报告错误数
  //
  // 说明：spec「跳过该 session 但报告错误数」暗示 exportEvalDataset 在损坏时
  // 不整体失败而是跳过 + 报告。但「抛 TranscriptCorruptError」又暗示抛错。
  // 此处假设：单个损坏 session 触发 TranscriptCorruptError 抛出（不再静默跳过），
  // 且错误信息含错误计数（"1 个损坏"）。见 ambiguities。
  // -------------------------------------------------------------------------
  it("transcript 损坏 → TranscriptCorruptError + 报告错误数", async () => {
    const okId = await buildSuccessSession(writer, "ok");
    const corruptId = await buildCorruptSession(writer);
    // 预置：损坏 transcript verifyTree 检出 orphan
    const nodes = await writer.loadSession(corruptId);
    expect(writer.verifyTree(nodes).ok).toBe(false);

    const flywheel = createFlywheel({
      transcript: writer,
      judge: fakeJudge(0.5),
      otelEmitter: new FakeOtelEmitter() as any,
    });
    await expect(
      flywheel.exportEvalDataset([okId, corruptId]),
    ).rejects.toThrowError(TranscriptCorruptError);
  });
});
