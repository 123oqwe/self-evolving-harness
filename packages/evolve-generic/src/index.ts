// PLG-T07: @harness/evolve-generic — YAML 声明式通用适配器包入口。
//
// Spec: execution/plugin/TASKS.md §PLG-T07。
// 为调研未核实到的 harness（GrokBuild/dsh 等）提供 YAML 声明式兜底：
// 用户写一份 *.adapter.yaml（路径映射 + 格式声明），generic adapter 据此
// 实现 HarnessPort 6 方法即接入。

export type {
  GenericAdapterConfig,
  GenericTrajectoryFormat,
} from "./config.js";
export { loadGenericConfig, validateConfig, InvalidGenericConfigError } from "./config.js";
export { parseTrajectories, extractByFields } from "./parsers.js";
export {
  GenericAdapter,
  createGenericPlugin,
} from "./generic-adapter.js";
export type { GenericAdapterOptions } from "./generic-adapter.js";
