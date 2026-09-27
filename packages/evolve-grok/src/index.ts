// @harness/evolve-grok · Grok Build HarnessPort 适配器（PLG-T12）。
//
// Spec: execution/plugin/TASKS.md §PLG-T12。
//
// 复用铁律（§0.2）：薄委托 ClaudeCodeAdapter（claude-compat 基质读写）+
// grok 原生插件目录生成 + trajectory offline 降级。进化逻辑全部 delegate
// 给 @harness/evolve-core runEvolutionCycle（本包只做 4 方法映射）。

export {
  GrokAdapter,
  createGrokPlugin,
  routeSubstrateId,
  GROK_CLAUDE_PREFIX,
  GROK_PLUGIN_PREFIX,
} from "./grok-adapter.js";
export type { GrokAdapterOptions, RoutedSubstrateId } from "./grok-adapter.js";
export {
  renderGrokPluginDir,
  renderHooksJson,
  InvalidHooksError,
} from "./plugin-dir.js";
export type { GrokPluginDirSpec } from "./plugin-dir.js";
export {
  readGrokTrajectories,
  extractGrokDiagnosis,
  mapGrokLineToTrajectory,
} from "./trajectory.js";
export type { GrokLogLine } from "./trajectory.js";
