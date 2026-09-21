// @harness/telemetry — TL 模块公共导出
//
// 注意：本 index.ts 是 TL 模块各任务（T01/T02/T05/T06...）的共享 barrel。
// 各任务在并行开发中各自追加 `export * from './<module>'` 行。
// 当前已落地：TL-T01 transcript、TL-T05 schema-policy。
export * from "./schema-policy";
export * from "./transcript-schema";
export * from "./transcript";
export * from "./budget-policy";
// TL-T02: per-turn usage 五子类型 + 版本化价目表 + 多 agent 归因
// （Usage 类型由 transcript-schema 导出，此处不重复导出避免 barrel 冲突）
export * from "./price-table";
export * from "./attribution";
export * from "./usage";
// TL-T03: OTel GenAI 语义约定发射器（gen_ai.* spans/events + trace 传播）
export * from "./otel-context";
export * from "./otel-emitter";
// TL-T04: replay 复现率采集（fresh sandbox 重放 + 非确定 action 持久 setup）
export * from "./replay";
// TL-T07: otel_capture_policy + PII redaction filter（PII>0 立即 reject 硬门）
export * from "./capture-policy";
// TL-T08: Clio 式失败聚类 v0（embedding + clusterer_config 产出失败簇）
export * from "./clusterer-config";
export * from "./clustering";
