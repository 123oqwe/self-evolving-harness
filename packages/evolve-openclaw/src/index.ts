// PLG-T05: @harness/evolve-openclaw 包入口。
//
// Spec: execution/plugin/TASKS.md §PLG-T05。
// 导出 OpenClawAdapter + createOpenClawPlugin + OpenClawAdapterOptions +
// trajectory 纯函数（readOpenClawTrajectories/extractOpenClawDiagnosis/
// mergeTrajectorySources）+ substrate 映射 helper。

export {
  OpenClawAdapter,
  createOpenClawPlugin,
} from "./openclaw-adapter.js";
export type { OpenClawAdapterOptions } from "./openclaw-adapter.js";

export {
  readOpenClawTrajectories,
  readOpenClawJsonlTrajectories,
  readOpenClawSqliteTrajectories,
  extractOpenClawDiagnosis,
  mergeTrajectorySources,
} from "./trajectory.js";
export type { OpenClawJsonlLine } from "./trajectory.js";

export {
  mapOpenClawSubstratePath,
  makeOpenClawSubstrateHandle,
  openclawSubstrateBasename,
  OPENCLAW_SUBSTRATE_PREFIX,
} from "./substrate.js";
export type { LLMPort } from "./llm.js";
