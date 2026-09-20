// CE-T06 REFACTOR — revert 命令构造（static-core 标记）。
//
// 回滚机制本体是 static-core：agent 运行时只读，由 L0C pre-commit/breaker
// （L0C-T08/T10）守卫不被进化改写。本模块仅构造 `git checkout` 命令字符串，
// 不执行 shell（执行由调用方/集成层在 sandbox 内完成）。
//
// 来源：PRD §6.4 + research/02-telemetry-eval-engine §4.5（Anthropic rainbow
// + DGM keep-all variants for revert）。

import { execFileSync } from "node:child_process";

/** 构造回滚到 baselineSha 的 `git checkout` 命令（回滚 l1-config prompts 等可被进化改写的产物）。 */
export function buildRevertCmd(baselineSha: string): string {
  return `git checkout ${baselineSha} -- packages/l1-config/`;
}

/**
 * 回滚执行体选项（XM-T01 ERRATA-w2plus XM-03 锁定签名）。
 *
 * `workspaceDir` = 被进化基质所在的 git 仓库根；`scope` = 需回滚的路径
 * （相对 workspaceDir，如 `"prompts"` / `"packages/l1-config"`）。
 */
export interface RevertExecOptions {
  workspaceDir: string;
  scope: string;
}

/** 回滚执行结果（restored 恒为 true —— 失败由 git 抛错冒泡，不静默）。 */
export interface RevertExecResult {
  restored: true;
  sha: string;
}

/**
 * 回滚本体（static-core git checkout 执行体）。XM-T01 ERRATA-w2plus XM-03 锁定：
 * `revertExec(baselineSha, { workspaceDir, scope }): { restored: true; sha: string }`。
 *
 * 行为：在 `workspaceDir` 内执行 `git checkout <baselineSha> -- <scope>/`，
 * 将 `scope` 路径下的可被进化改写产物恢复到 baseline 版本。同步执行
 * （回滚是终态裁决，不异步等待）。
 *
 * 不变量：不 mutate 入参；失败由 git 非零 exit 冒泡（调用方/测试可见可断言）。
 * 来源：PRD §6.4 + cross-module/TASKS.md §XM-T01（回滚演练必须走本入口）。
 */
export function revertExec(
  baselineSha: string,
  opts: RevertExecOptions,
): RevertExecResult {
  const { workspaceDir, scope } = opts;
  // scope 末尾归一化不带分隔符，命令形如 `git checkout <sha> -- prompts/`。
  const normalizedScope = scope.replace(/\/+$/g, "");
  execFileSync(
    "git",
    ["-C", workspaceDir, "checkout", baselineSha, "--", `${normalizedScope}/`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return { restored: true, sha: baselineSha };
}
