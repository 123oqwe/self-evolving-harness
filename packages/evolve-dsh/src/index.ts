// @harness/evolve-dsh · DeepSeek Harness 插件包入口。
//
// PLG-T11: 把 HarnessPort 落到 dsh（github.com/deepseek-ai/deepseek-harness）。
// 形态 = dsh-plugin npm 包（monorepo workspace 包 + dsh-plugin 生态可发布）。
// 包只做 4 方法映射（基质/轨迹/部署/LLM），不重造进化逻辑（§0.2 复用铁律）。

export { DshAdapter, createDshPlugin, defaultDshHome } from "./dsh-adapter.js";
export type { DshAdapterOptions } from "./dsh-adapter.js";
export { mapDshSubstratePath } from "./substrate.js";
export type { DshSubstrateMapping } from "./substrate.js";
export {
  readDshTrajectories,
  eventStreamToTrajectory,
  extractDshDiagnosis,
  groupBySession,
  getSessionId,
} from "./trajectory.js";
export type { DshEvent } from "./trajectory.js";
export {
  syncProfileToDshHome,
  reverseSyncProfile,
  readProfilePatch,
  writeProfilePatch,
} from "./profile.js";
export type { LLMPort } from "./llm.js";
