// @harness/evolve-codex · Codex CLI HarnessPort 适配器（PLG-T02）。
//
// Spec: execution/plugin/TASKS.md §PLG-T02。
// 复用铁律（§0.2）：本包只做基质/轨迹/部署四方法映射，进化逻辑全部 delegate
// 给 @harness/evolve-core runEvolutionCycle + @harness/l3-engine。
//
// 零宿主重造：CodexAdapter implements HarnessPort（ADP-T01 契约），
// 基质=repoRoot/AGENTS.md，轨迹=CODEX_HOME rollout JSONL，LLM=透传外部注入。

export { CodexAdapter, createCodexPlugin } from "./codex-adapter.js";
export type { CodexAdapterOptions } from "./codex-adapter.js";
export {
  readCodexTrajectories,
  extractCodexDiagnosis,
  parseRolloutLine,
  threadIdFromFilename,
} from "./trajectory.js";
export type { RolloutLine } from "./trajectory.js";
export {
  mapCodexSubstratePath,
  makeCodexSubstrateHandle,
  codexSubstrateBasename,
  CODEX_SUBSTRATE_PREFIX,
} from "./substrate.js";
export { passThroughLlmPort } from "./llm.js";
