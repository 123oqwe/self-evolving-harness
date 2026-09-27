// @harness/evolve-hermes · package entry.
//
// PLG-T04: Hermes Agent HarnessPort 适配器（薄插件包，300–800 行，只做基质/轨迹/
// 部署四方法映射，不重造进化逻辑）。
//
// 复用铁律（§0.2）：evolve 逻辑只在 @harness/evolve-core，本包只 implements
// HarnessPort。消费方经 evolve-core runEvolutionCycle({ harnessPort: createHermesPlugin(opts), ... })
// 即可对 Hermes 基质跑 mine→mutate→score→select→deploy→verify。

export {
  HermesAdapter,
  createHermesPlugin,
} from "./hermes-adapter.js";
export type { HermesAdapterOptions } from "./hermes-adapter.js";
export { mapHermesSubstratePath, HERMES_SUBSTRATE_PREFIX } from "./substrate.js";
export { readHermesTrajectories } from "./trajectory.js";
export {
  buildCronJobSpec,
  isValidSchedule,
  InvalidScheduleError,
} from "./cron-trigger.js";
export type { CronTriggerOptions } from "./cron-trigger.js";
export type { LLMPort } from "./llm.js";
