// @harness/evolve-cursor · Cursor harness 薄插件包（离线进化模式）。
//
// Spec: execution/plugin/TASKS.md §PLG-T06。
// 复用铁律（§0.2）：本包只做基质/轨迹/部署四方法映射，不重造进化逻辑——
// 进化闭环 delegate 给 @harness/evolve-core runEvolutionCycle（offline 模式）。

export {
  CursorAdapter,
  createCursorPlugin,
  CURSOR_AUTO_DISCOVER_HINT,
} from "./cursor-adapter.js";
export type { CursorAdapterOptions } from "./cursor-adapter.js";
export {
  mapCursorSubstratePath,
  makeCursorSubstrateHandle,
  cursorSubstrateBasename,
  parseMdc,
  CURSOR_SUBSTRATE_PREFIX,
} from "./substrate.js";
export type { ParsedMdc } from "./substrate.js";
export { buildOfflineConfig } from "./offline-cycle.js";
export type { LLMPort } from "./llm.js";
export { passThroughLLM } from "./llm.js";
