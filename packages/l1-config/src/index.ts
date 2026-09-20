// L1-config package entry.
// L1-T01: ConfigRepo + ConfigSet + ScopeGuard + sha 钉死 + reload 语义。
// L1-T02: compaction summary prompt 基质 + baseline + recall 信号采集。
export * from "./repo-layout.js";
export * from "./substrate-types.js";
export * from "./compaction-substrate.js";
// L1-T03: signature verification + phase substrate + warm-up cache-hit.
export * from "./signature.js";
export * from "./phase-types.js";
export * from "./phase-substrate.js";
// L1-T04a: compaction prompt 进化 loop-a beam-search reflective mutation 驱动器。
export * from "./evolution-driver.js";
// L1-T04b: compaction 进化 loop-b strict-improvement + Pareto + commit-on-success + canary 配置面。
export * from "./select-retain.js";
export * from "./canary-config-plane.js";
// L1-T05a: phase prompt 进化 loop-a beam-search reflective mutation 驱动器。
export * from "./phase-evolution-driver.js";
// L1-T05b: phase 进化 loop-b select + cache warm-up 软多目标 + canary 配置面。
export * from "./phase-select-retain.js";
