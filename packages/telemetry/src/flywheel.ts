// TL-T10: trajectory replay + distillation flywheel（ATIF 格式 + eval dataset + LLM-judge score）
//
// flywheel = replay → distill → judge → export eval dataset → 喂 L3 进化
// （research §1.4 (a)）。成功低 token 轨迹导出为 ATIF eval dataset；LLM-as-judge
// 打 0-1 score 落 `gen_ai.evaluation.*` span。
//
// 复用：TL-T01 transcript（loadSession/verifyTree）、TL-T09 distill selector 语义
// （只选成功轨迹）、TL-T03 OTel gen_ai.evaluation.* 语义约定。
// 自研：flywheel 编排（replay → select → judge → export）。
//
// ERRATA-w2plus TL-T10 裁决：
//   - createFlywheel(opts: { transcript: TranscriptWriter; judge?: (t) => Promise<number>; otelEmitter?: unknown })
//   - transcript 损坏 → 抛 TranscriptCorruptError（含 errors 字段报告损坏数），不静默跳过
//   - ATIFDataset 须含 errors?: number
//
// 已知坑：LLM-judge 必须经 CE-T05 去偏配置（注入侧负责），不可直接用同模型
// self-judge（self-preference，PRD §6.2）。judgeTrajectory 落 span 时用
// gen_ai.evaluation.name / gen_ai.evaluation.score 标准字段。

import type { TranscriptWriter } from "./transcript";
import type { TranscriptNode, NormalizedBlock, Usage } from "./transcript-schema";
import type { Trajectory } from "./distill-selector";
import { TranscriptCorruptError } from "./replay";
import {
  ATIF_VERSION,
  type ATIFDataset,
  type ATIFRecord,
  type TrajectoryStep,
} from "./atif";

// ---------------------------------------------------------------------------
// 公共接口签名（spec §TL-T10 接口签名）
// ---------------------------------------------------------------------------

/** Flywheel 公共接口（spec §TL-T10 接口签名）。 */
export interface Flywheel {
  /** 导出成功 session 为 ATIF eval dataset（distill 只选成功，与 TL-T09 一致）。 */
  exportEvalDataset(sessionIds: string[]): Promise<ATIFDataset>;
  /** LLM-as-judge 打 0-1 score → 落 gen_ai.evaluation.* span。 */
  judgeTrajectory(t: Trajectory): Promise<number>;
}

// ---------------------------------------------------------------------------
// 最小 OTel emitter 接口（judgeTrajectory 落 evaluation span 用）
//
// otelEmitter 由 opts 注入（类型 unknown，运行时按鸭子类型调用）。
// 兼容 TL-T03 OtelEmitter（startLLMSpan 返回 Span，setAttribute 可用）与
// 测试 FakeOtelEmitter（startLLMSpan(ctx?) 返回 FakeSpan）。
// ---------------------------------------------------------------------------
interface JudgeOtelSpan {
  setAttribute(key: string, value: unknown): unknown;
  end?(): void;
}
interface JudgeOtelEmitter {
  startLLMSpan(ctx?: {
    operation?: string;
    model?: string;
    [k: string]: unknown;
  }): JudgeOtelSpan;
  endLLMSpan?(span: JudgeOtelSpan, usage?: unknown): void;
}

/** 默认 judge（未注入时）：返回中性 0.5（不偏 distill 选择）。 */
const DEFAULT_JUDGE = async (_t: Trajectory): Promise<number> => 0.5;

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

export interface CreateFlywheelOpts {
  transcript: TranscriptWriter;
  /** LLM-judge 注入（CE-T05 去偏配置由注入侧负责）。 */
  judge?: (t: Trajectory) => Promise<number>;
  /** OTel emitter 注入（鸭子类型，落 gen_ai.evaluation.* span）。 */
  otelEmitter?: unknown;
}

/**
 * 创建 flywheel。
 *
 * - transcript：TL-T01 writer（loadSession/verifyTree）
 * - judge：LLM-as-judge（0-1 score）；缺省 0.5
 * - otelEmitter：落 gen_ai.evaluation.* span；缺省 no-op
 */
export function createFlywheel(opts: CreateFlywheelOpts): Flywheel {
  const transcript = opts.transcript;
  const judge = opts.judge ?? DEFAULT_JUDGE;
  const otelEmitter = opts.otelEmitter as JudgeOtelEmitter | undefined;

  return {
    async exportEvalDataset(sessionIds: string[]): Promise<ATIFDataset> {
      const records: ATIFRecord[] = [];
      let corruptCount = 0;

      for (const sessionId of sessionIds) {
        const nodes = await transcript.loadSession(sessionId);
        const verify = transcript.verifyTree(nodes);
        if (!verify.ok) {
          // ERRATA 裁决：抛错语义，不静默跳过。累计损坏数后统一抛。
          corruptCount += 1;
          continue;
        }
        // distill 只选成功轨迹（与 TL-T09 一致）
        if (!isSessionSuccess(nodes)) continue;

        const trajectory = buildTrajectory(sessionId, nodes);
        const judgeScore = await clampScore(await judge(trajectory));
        records.push({
          task: deriveTask(nodes),
          steps: buildSteps(nodes),
          outcome: "success",
          totalTokens: computeTotalTokens(nodes),
          judgeScore,
        });
      }

      if (corruptCount > 0) {
        throw new TranscriptCorruptError(
          `TranscriptCorruptError: ${corruptCount} corrupt session(s) detected during exportEvalDataset`,
        );
      }

      return {
        format: "ATIF",
        version: ATIF_VERSION,
        records,
        errors: 0,
      };
    },

    async judgeTrajectory(t: Trajectory): Promise<number> {
      const score = clampScore(await judge(t));
      // 落 gen_ai.evaluation.* span（OTel GenAI 语义约定）
      if (otelEmitter && typeof otelEmitter.startLLMSpan === "function") {
        const span = otelEmitter.startLLMSpan({
          operation: "judge",
          model: "llm-judge",
        });
        if (span && typeof span.setAttribute === "function") {
          span.setAttribute("gen_ai.evaluation.name", "distill-judge");
          span.setAttribute("gen_ai.evaluation.score", score);
        }
        if (otelEmitter.endLLMSpan) {
          otelEmitter.endLLMSpan(span);
        } else if (span && typeof span.end === "function") {
          span.end();
        }
      }
      return score;
    },
  };
}

// ---------------------------------------------------------------------------
// 辅助：transcript → trajectory / record 字段
// ---------------------------------------------------------------------------

/** 检测 session 是否成功：无 is_error 的 tool_result 块 → success。 */
function isSessionSuccess(nodes: TranscriptNode[]): boolean {
  for (const n of nodes) {
    if (!Array.isArray(n.content)) continue;
    for (const block of n.content) {
      if (
        block &&
        typeof block === "object" &&
        (block as NormalizedBlock).type === "tool_result" &&
        (block as { is_error?: boolean }).is_error === true
      ) {
        return false;
      }
    }
  }
  return true;
}

/** 提取节点 content 中的文本块拼接为字符串。 */
function extractText(content: NormalizedBlock[] | undefined): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && block.type === "text") {
      parts.push(block.text);
    }
  }
  return parts.join("");
}

/** 构造 Trajectory（供 judge）。embedding 默认 [0]（flywheel 不做多样性度量）。 */
function buildTrajectory(sessionId: string, nodes: TranscriptNode[]): Trajectory {
  return {
    sessionId,
    success: true,
    totalTokens: computeTotalTokens(nodes),
    taskType: "code",
    embedding: [0],
  };
}

/** 从首条 user 节点文本派生 task 标识。 */
function deriveTask(nodes: TranscriptNode[]): string {
  for (const n of nodes) {
    if (n.type === "user") {
      const text = extractText(n.content);
      if (text.length > 0) return text;
    }
  }
  return nodes[0]?.sessionId ?? "unknown";
}

/** 将 transcript 节点转为 ATIF TrajectoryStep 序列。 */
function buildSteps(nodes: TranscriptNode[]): TrajectoryStep[] {
  const steps: TrajectoryStep[] = [];
  for (const n of nodes) {
    const text = extractText(n.content);
    if (n.type === "assistant") {
      // 提取首个 tool_use 块作为 toolUse
      let toolUse: TrajectoryStep["toolUse"];
      if (Array.isArray(n.content)) {
        for (const block of n.content) {
          if (
            block &&
            typeof block === "object" &&
            block.type === "tool_use"
          ) {
            toolUse = { name: block.name, input: block.input };
            break;
          }
        }
      }
      steps.push({
        role: "assistant",
        content: text,
        ...(toolUse !== undefined ? { toolUse } : {}),
      });
    } else if (n.type === "user") {
      steps.push({ role: "user", content: text });
    } else if (n.type === "tool_result") {
      steps.push({ role: "tool", content: text });
    } else if (n.type === "system") {
      steps.push({ role: "system", content: text });
    }
    // subagent_boundary 不进 step 序列
  }
  return steps;
}

/** 计算所有 assistant 节点 usage 五子类型之和。 */
function computeTotalTokens(nodes: TranscriptNode[]): number {
  let total = 0;
  for (const n of nodes) {
    const u = n.usage as Usage | undefined;
    if (!u) continue;
    total +=
      (u.input ?? 0) +
      (u.output ?? 0) +
      (u.cache_read ?? 0) +
      (u.cache_creation ?? 0) +
      (u.reasoning ?? 0);
  }
  return total;
}

/** clamp score 到 [0,1]。 */
function clampScore(s: number): number {
  if (typeof s !== "number" || !Number.isFinite(s)) return 0;
  return Math.min(1, Math.max(0, s));
}
