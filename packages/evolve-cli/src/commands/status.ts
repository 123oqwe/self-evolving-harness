// evolve-cli · `evolve status`（PLG-T08 commands/status.ts）。
//
// Spec: execution/plugin/TASKS.md §PLG-T08 接口签名逐字对齐。
// 读 .harness/evolve-state.json → 打印 retain/committed/canary/offline；
// state 不存在 → 打印 "no evolution run yet"（exit 0，不抛）。

import { readState } from "../state.js";

/** `evolve status`：显示上次进化运行状态。 */
export async function runStatus(cwd: string): Promise<void> {
  const state = readState(cwd);
  if (!state) {
    process.stdout.write("no evolution run yet (run 'evolve run' first)\n");
    return;
  }
  const committed = state.committed
    ? `${state.committed.sha} (origin: ${state.committed.origin})`
    : "none";
  const canary = state.canaryRelease
    ? `${state.canaryRelease.decision} (variant: ${state.canaryRelease.variantSha})`
    : "none";
  const lines = [
    "evolve status:",
    `  retain: ${state.retain} (retainedMutants: ${state.retainedMutants})`,
    `  committed: ${committed}`,
    `  canary: ${canary}`,
    `  offline: ${state.offline}`,
    `  baselineResolveRate: ${state.baselineResolveRate} → postRevert: ${state.postRevertResolveRate}`,
  ];
  process.stdout.write(lines.join("\n") + "\n");
}
