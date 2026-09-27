// @harness/evolve-opencode · OpenCode harness 薄插件包（PLG-T03）。
//
// Spec: execution/plugin/TASKS.md §PLG-T03。
//
// 复用铁律（§0.2）：本包只做基质/轨迹/部署四方法映射，不重造进化逻辑。
// 进化编排由 @harness/evolve-core runEvolutionCycle 消费本包提供的 HarnessPort。

export { OpenCodeAdapter, createOpenCodePlugin } from "./opencode-adapter.js";
export type { OpenCodeAdapterOptions } from "./opencode-adapter.js";
export {
  mapOpenCodeSubstratePath,
  makeSubstrateHandle,
  substrateBasename,
  OPENCODE_SUBSTRATE_PREFIX,
} from "./substrate.js";
export {
  readOpenCodeTrajectories,
  reassembleSession,
  extractOpenCodeDiagnosis,
} from "./trajectory.js";
export type { OpenCodeSessionInfo } from "./trajectory.js";
export { resolveLlmPort } from "./llm.js";
