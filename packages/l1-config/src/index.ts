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
