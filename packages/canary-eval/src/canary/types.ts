// CE-T01a: Canary held-out 集 v0-a 类型定义。
//
// 接口签名严格对齐 execution/canary-eval/TASKS.md §CE-T01a + ERRATA-w2plus 裁决：
// - 字段名/嵌套/可选性一字不差。
// - Trajectory 由本任务首次定义并 @harness/canary-eval 导出（CE-T03/CE-T05 复用）。

/**
 * 单条 canary 任务（static-core，冻结于 release）。
 *
 * - `verify` 为 shell 命令：exit 0 = pass（bigpowers verify-work `verify:` field 风格）。
 * - `expectedExit` 固定为 0（确定性 oracle，L0）。
 * - `decontaminated` 标记是否通过 SWE-rebench 风格去污染（repo 结构定位不命中 trainSet）。
 * - `frozenInRelease` 为 release pin sha（agent 不可见/不可训/不可改）。
 */
export interface CanaryTask {
  id: string; // e.g. 'CE-TASK-0001'
  repo: string; // 源仓定位（不离开源仓风格）
  verify: string; // shell 命令，exit 0=pass
  expectedExit: 0;
  decontaminated: boolean;
  frozenInRelease: string; // release sha
}

/**
 * Canary manifest（release pin）。
 *
 * yaml schema 直映接口字段（ERRATA-w2plus CE-01）：
 *   version / sha256 / frozenAt / agentVisible: false / tasks[]
 * 字段名/嵌套与 TS 接口一一对应，禁止 alias。
 *
 * `agentVisible` 为不变量：恒为 `false`（agent 运行时无读权，CE 侧只校验该不变量，
 * filesystem ACL EPERM 由 L0S-T03 保证）。
 */
export interface CanaryManifest {
  version: string;
  sha256: string;
  frozenAt: string;
  tasks: CanaryTask[];
  agentVisible: false;
}

/**
 * 团队自用 pi AgentSession 历史轨迹（trainSet D 的元素）。
 *
 * 由 CE-T01a 首次定义并导出；CE-T03/CE-T05 复用不同形状的 Trajectory（以导入来源区分，
 * spec 不改名，见 ERRATA-w2plus §CE 跨任务 `Trajectory` 导出条目）。
 *
 * `isDecontaminated` 的“repo 结构定位命中”= **仓库名相等**（`task.repo === traj.repo`）；
 * 不做 repo-snapshot 文件树指纹比对（V1 才引入指纹）。
 */
export interface Trajectory {
  sessionId: string;
  repo: string;
  toolCalls?: { tool: string; input: unknown; result: string }[];
  outcome?: "pass" | "fail";
}
