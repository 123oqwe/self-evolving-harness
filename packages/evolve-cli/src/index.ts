// @harness/evolve-cli · 统一 CLI 包入口（PLG-T08）。
//
// Spec: execution/plugin/TASKS.md §PLG-T08。
// evolve init --harness <id> / evolve run / evolve status。
// arg 解析用 node:util parseArgs（Node 20+ 内置，无框架依赖，spec 执行提示 (1)）。

export { runInit, UnsupportedHarnessError } from "./commands/init.js";
export type { InitOptions } from "./commands/init.js";
export {
  runRun,
  runRunWithFactory,
  EvolveConfigNotFoundError,
  loadCanaryTasks,
  resolveAdapterOpts,
} from "./commands/run.js";
export type { RunOptions } from "./commands/run.js";
export { runStatus } from "./commands/status.js";
export { loadRegistry, SUPPORTED_HARNESS, DEFAULT_SUBSTRATE_ID } from "./registry.js";
export { readState, writeState, statePath } from "./state.js";
export type { EvolveState } from "./state.js";
export {
  resolveLlmPort,
  HttpLlmPort,
  LlmPortNotConfiguredError,
  httpLlmConfigFromEnv,
} from "./llm.js";
export type { HttpLlmConfig } from "./llm.js";
export { runCli } from "./cli.js";
