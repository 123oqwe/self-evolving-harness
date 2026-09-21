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
// L1-T06: tool description/field-doc 基质 + selection-accuracy 信号采集。
export * from "./tool-registry.js";
// L1-T07: tool description 进化 loop（ExpeL+TextGrad，schema 形状锁；selection∧resolve 联合；贬抑语 flag）。
export * from "./tool-evolution.js";
// L1-T08: tool sub-set/defer config + 进化（defer 不隐藏安全关键工具）。
export * from "./tool-subset-defer.js";
// L1-T09: history-processors 链 config + 进化（cut 边界 static-core）。
export * from "./history-processors.js";
// L1-T10: per-tool maxLines/maxBytes + timeout 进化（下限锁；错误类禁 head；破坏性工具人审）。
export * from "./tool-truncation-timeout.js";
// L1-T11: CLAUDE.md/steering patch 基质（ExpeL insight；人审每 diff；decontaminated 验证）。
export * from "./steering-patch.js";
// L1-T12a: hook policy（PreToolUse 规则）基质 + breaker clause + silence≠approve。
export * from "./hook-policy.js";
// L1-T13: HITL pause/approve policy 进化（重复副作用=0 hard；false-pause↓；RunState static-core；breaker）。
export * from "./hitl-policy.js";
// L1-T14: delegation spec/effort-scaling 基质 + 进化（必填字段名 static-core；变异器独立 session）。
export * from "./delegation-substrate.js";
// L1-T15: context mode 路由 + summarized handoff 模板进化（fork/fresh 不变量 static-core）。
export * from "./context-mode-router.js";
// L1-T16: reducer 表 + partition 策略进化（barrier await+tool_use_id static-core；custom_lua 沙箱；partition 不重叠）。
export * from "./reducer-partition.js";
// L1-T17: handoff description + input_type schema 进化（on_handoff/is_enabled static-core；鉴权字段人工 gate）。
export * from "./handoff-schema.js";
// L1-T18: steering policy + 措辞模板进化（checkpoint/REDIRECT/consume-once static-core；KILL/PAUSE 人工 gate）。
export * from "./steering-policy.js";
// L1-T19: failure recovery policy + 幂等 checklist 进化（super-step+node 幂等 static-core）。
export * from "./failure-recovery.js";
