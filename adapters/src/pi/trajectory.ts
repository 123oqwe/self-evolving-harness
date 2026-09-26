// ADP-T02: TL-T01 形状 JSONL → L3 Trajectory 解析。
//
// Spec: execution/adapt/TASKS.md §ADP-T02 (trajectory.ts).
// 复用铁律（§0.2）：`Trajectory` 形状从 `@harness/l3-engine` 导入；TL-T01
// TranscriptNode 字段对齐 tests/TL/T01-transcript.spec.ts；失败诊断提取复用
// ReferenceAdapter 的 `extractDiagnosis` 纯函数（不重造）。
//
// 注意：本文件不扫 pi 原生 `~/.pi/agent/sessions/`（pi 私有格式，与 TL-T01
// 不同构）。pi 适配器消费的是 instrumented pi 经 TranscriptWriter 落盘的
// TL-T01 轨迹。

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Trajectory } from "@harness/l3-engine";
import { extractDiagnosis } from "../port.js";

/**
 * 扫描 trajectoryDir 下 `<session-id>.jsonl`，逐文件解析 TL-T01 形状
 * TranscriptNode[]，映射为 Trajectory[]。
 *
 * 行为：
 *  - 非法 JSONL 行 → 跳过该行并 warn（不崩），合法行仍参与诊断提取。
 *  - 整文件无法解析出失败诊断（无 is_error assistant 节点）→ 跳过该 session。
 *  - substrateSha 透传存入 Trajectory（不做过滤，由上游 CE-T03 / Lucky-Pass 守卫）。
 */
export function readTlTrajectories(
  trajectoryDir: string,
  substrateSha: string,
): Trajectory[] {
  if (!existsSync(trajectoryDir)) return [];
  const out: Trajectory[] = [];
  let files: string[] = [];
  try {
    files = readdirSync(trajectoryDir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }
  for (const file of files) {
    const sessionId = file.slice(0, -".jsonl".length);
    const abs = join(trajectoryDir, file);
    let text: string;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    // 逐行解析：合法行入 nodes，非法行跳过 + warn。
    const nodes: unknown[] = [];
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        nodes.push(JSON.parse(line));
      } catch {
        // 非法 JSONL 行 → 跳过该行（spec 错误路径：不崩）。
        // eslint-disable-next-line no-console
        console.warn(
          `[pi-adapter] skipping malformed JSONL line in ${file}`,
        );
      }
    }
    const diag = extractDiagnosis(nodes);
    if (diag === null) {
      // 无失败信号 → 非失败轨迹，跳过。
      continue;
    }
    out.push({
      id: sessionId,
      sessionId,
      substrateSha,
      failed: true,
      diagnosis: diag,
      luckyPass: false,
      raw: nodes,
    });
  }
  return out;
}
