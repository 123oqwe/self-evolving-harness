// ISS-08: 失败轨迹源真实性 —— Trajectory.source 契约 + deploy 前置门 + 真实 TL-T01 JSONL reader。
//
// 背景：run-001 §2 三条失败轨迹均为手工构造（synthetic），mine 步从未在真实数据上跑。
// 本模块落地 ISS-08 修复：
//   1. deploySourceGate —— 全部候选轨迹 source==="synthetic" 时只允许 dry-run，
//      deploy 被拒（除非显式 allowSyntheticDeploy 且报告标注）。
//   2. readTlTrajectories —— 从 TL-T01 TranscriptWriter 落盘 JSONL 读取失败轨迹，
//      产出 source:"real" 的 Trajectory[]（走通 mine 步的真实源）。
//
// 复用铁律（§0.2）：Trajectory 形状从 @harness/contracts 导入（不重定义）；
// TL-T01 TranscriptNode 诊断提取逻辑与 adapters extractDiagnosis 同构，但
// canary-eval 不能反向依赖 adapters（依赖方向 adapters → l3-engine → canary-eval
// 单向），故本地实现一个最小 TL-T01 诊断提取纯函数（字段对齐，非新算法）。

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Trajectory } from "@harness/contracts";

/** 轨迹来源：real = 真实会话日志；synthetic = 手工构造。 */
export type TrajectorySource = "real" | "synthetic";

/** deploy 前置判定结果。 */
export interface DeploySourceGateResult {
  /** true = 允许 deploy；false = 只允许 dry-run（全部 synthetic 且未显式放行）。 */
  allowDeploy: boolean;
  mode: "deploy" | "dry-run";
  reason: string;
  syntheticCount: number;
  realCount: number;
  total: number;
}

/**
 * deploy 前置判定：全部候选轨迹 source 为 synthetic 时，只允许 dry-run。
 *
 * - total > 0 且 syntheticCount === total → 全 synthetic：
 *     - allowSyntheticDeploy !== true → { allowDeploy: false, mode: "dry-run" }
 *     - allowSyntheticDeploy === true → { allowDeploy: true, mode: "deploy", reason 标注 }
 * - 其余（含空集）→ { allowDeploy: true, mode: "deploy" }（空集无合成-only 信号，
 *   由上游 mine 步保证空集不进 deploy）。
 */
export function deploySourceGate(
  trajectories: readonly Trajectory[],
  opts: { allowSyntheticDeploy?: boolean } = {},
): DeploySourceGateResult {
  const total = trajectories.length;
  const syntheticCount = trajectories.filter(
    (t) => t.source === "synthetic",
  ).length;
  const realCount = total - syntheticCount;
  const allSynthetic = total > 0 && syntheticCount === total;

  if (allSynthetic && opts.allowSyntheticDeploy !== true) {
    return {
      allowDeploy: false,
      mode: "dry-run",
      reason:
        "all trajectories are synthetic — deploy blocked (dry-run only)",
      syntheticCount,
      realCount,
      total,
    };
  }
  if (allSynthetic) {
    return {
      allowDeploy: true,
      mode: "deploy",
      reason:
        "all-synthetic but allowSyntheticDeploy flag set (report must annotate)",
      syntheticCount,
      realCount,
      total,
    };
  }
  return {
    allowDeploy: true,
    mode: "deploy",
    reason: "has real trajectory source",
    syntheticCount,
    realCount,
    total,
  };
}

// ---------------------------------------------------------------------------
// TL-T01 TranscriptNode 最小形状 + 诊断提取（字段对齐 adapters extractDiagnosis）
// ---------------------------------------------------------------------------

interface TlLikeNode {
  readonly type?: string;
  readonly content?: unknown;
}

/** 从 TL-T01 TranscriptNode[] 提取失败诊断（无 is_error → null）。 */
export function extractTlDiagnosis(nodes: unknown[]): string | null {
  for (const node of nodes as TlLikeNode[]) {
    if (node.type !== "assistant") continue;
    const content = node.content;
    if (!Array.isArray(content)) continue;
    for (const part of content as Array<Record<string, unknown>>) {
      if (part && part.is_error === true) {
        const c = part.content;
        if (typeof c === "string") return c;
        if (Array.isArray(c)) {
          const txt = c
            .map((x) =>
              typeof x === "string" ? x : (x as { text?: string })?.text ?? "",
            )
            .join(" ");
          if (txt.trim()) return txt;
        }
        return JSON.stringify(c);
      }
    }
  }
  return null;
}

/**
 * 从 TL-T01 TranscriptWriter 落盘 JSONL 读取失败轨迹 → source:"real" Trajectory[]。
 *
 * 行为（对齐 adapters readTlTrajectories）：
 *  - trajectoryDir 不存在 → []。
 *  - 逐 `<session-id>.jsonl` 文件、逐行解析；非法行跳过不崩。
 *  - 整文件无 is_error assistant 节点 → 跳过（非失败 session）。
 *  - substrateSha 透传存入 Trajectory。
 */
export function readTlTrajectories(
  trajectoryDir: string,
  substrateSha: string,
): Trajectory[] {
  if (!existsSync(trajectoryDir)) return [];
  let files: string[] = [];
  try {
    files = readdirSync(trajectoryDir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const out: Trajectory[] = [];
  for (const file of files) {
    const sessionId = file.slice(0, -".jsonl".length);
    const abs = join(trajectoryDir, file);
    let text: string;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const nodes: unknown[] = [];
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        nodes.push(JSON.parse(line));
      } catch {
        // 非法 JSONL 行 → 跳过（spec 错误路径：不崩）。
      }
    }
    const diag = extractTlDiagnosis(nodes);
    if (diag === null) continue;
    out.push({
      id: sessionId,
      sessionId,
      substrateSha,
      source: "real",
      failed: true,
      diagnosis: diag,
      luckyPass: false,
      raw: nodes,
    });
  }
  return out;
}
