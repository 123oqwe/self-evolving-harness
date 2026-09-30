// ISS-16 (选项 A): 实验性/未接入优化器——库可用但未接入闭环。
// 状态见 README「优化器状态矩阵」。主入口 index.ts 保留兼容再导出一个版本后移除。
export { AdasMetaSearchOptimizer } from "./optimizers/adas-meta-search.js";
export { FullPopulationBeamSearch } from "./full-population-beam-search.js";
export { FullParetoSelector } from "./full-pareto-selector.js";
export { IslandArchive } from "./archive/island-mapelites.js";
export { AFlowMctsOptimizer } from "./optimizers/aflow-mcts.js";
export { TextGradOptimizer } from "./optimizers/textgrad.js";
export { BayesianSurrogate, TrainValLeak } from "./optimizers/bayesian-surrogate.js";
