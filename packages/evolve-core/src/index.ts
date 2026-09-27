// @harness/evolve-core · 宿主无关进化循环入口（PLG-T01）。
//
// Spec: execution/plugin/TASKS.md §PLG-T01。
//
// 复用铁律（§0.2）：本包只做宿主无关编排（mine→mutate→score→select→deploy→
// verify 串联），进化逻辑全部 delegate 给 @harness/l3-engine runEvolutionLoop
// （closed loop）+ @harness/canary-eval（canaryRelease/revertExec）。零宿主
// 依赖：deps 仅 @harness/adapters + @harness/l3-engine + @harness/canary-eval。

export type {
  EvolveCanaryTask,
  EvolvePluginFactory,
  EvolveConfig,
  EvolveResult,
} from "./config.js";
export { runEvolutionCycle, InsufficientCanaryError } from "./cycle.js";
export { OfflineMutator } from "./offline-mutator.js";
