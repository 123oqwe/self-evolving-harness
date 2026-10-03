// ISS-02 步骤①: 部署后打分(substrate 依赖注入骨架)。
//
// 问题: score 步直接在 canary 任务(各自 fixture)上 runVerify，被进化基质从未
// 被部署到 canary 可见路径，故打分对基质无因果。
//
// 修复: canary manifest 声明 substrate 依赖；score 把候选写入临时 workspace，
// 以 `HARNESS_SUBSTRATE_PATH` 环境变量注入 verify 命令(baseline 同法)。代理任务
// (ISS-02 步骤②)读取该路径对被进化基质做结构检查 → 候选破坏结构即降分。
//
// 本模块提供纯/薄工具: 注入环境变量前缀 + 部署基质到 workspace + 带注入地跑单条
// 代理任务。评分编排由 l3-engine 闭环或 scripts/run-evolution-001.mjs 组装。

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { CanaryTask } from "./types.js";
import { runVerify } from "../verifier.js";
import type { VerifierRun, SandboxHandle } from "../verifier.js";

/** 基质注入环境变量名(代理任务 verify 命令读取)。 */
export const SUBSTRATE_ENV = "HARNESS_SUBSTRATE_PATH";

/** canary 任务声明的基质依赖(manifest 侧)。 */
export interface SubstrateDependency {
  path: string; // 仓库相对基质路径(如 packages/l1-config/prompts/compaction-summary.md)
  kind: "prompt" | "workflow" | "skill" | "weight";
}

/** 把基质路径注入 verify 命令(前缀 `HARNESS_SUBSTRATE_PATH=<path> `)。 */
export function injectSubstratePath(cmd: string, substratePath: string): string {
  return `${SUBSTRATE_ENV}=${JSON.stringify(substratePath)} ${cmd}`;
}

/**
 * 把基质内容写入临时 workspace，返回绝对路径。
 * baseline 与候选同法部署，保证「部署后打分」两者走同一注入通道。
 */
export function deploySubstrateToWorkspace(
  content: string,
  workspaceDir: string,
  relPath: string,
): string {
  const abs = join(workspaceDir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
  return abs;
}

/**
 * 在注入 `HARNESS_SUBSTRATE_PATH` 的条件下跑单条任务 verify(部署后打分原语)。
 *
 * 传入 `task.verify` 不变量; 返回的 `VerifierRun.command` 记录注入后的命令，
 * 便于审计「命令确实带上了基质路径」。
 */
export async function scoreSubstrateTask(
  task: CanaryTask,
  substratePath: string,
  sandbox: SandboxHandle,
): Promise<VerifierRun> {
  return runVerify(
    { ...task, verify: injectSubstratePath(task.verify, substratePath) },
    { sandbox },
  );
}
