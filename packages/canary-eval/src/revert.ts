// CE-T06 REFACTOR — revert 命令构造（static-core 标记）。
//
// 回滚机制本体是 static-core：agent 运行时只读，由 L0C pre-commit/breaker
// （L0C-T08/T10）守卫不被进化改写。本模块仅构造 `git checkout` 命令字符串，
// 不执行 shell（执行由调用方/集成层在 sandbox 内完成）。
//
// 来源：PRD §6.4 + research/02-telemetry-eval-engine §4.5（Anthropic rainbow
// + DGM keep-all variants for revert）。

/** 构造回滚到 baselineSha 的 `git checkout` 命令（回滚 l1-config prompts 等可被进化改写的产物）。 */
export function buildRevertCmd(baselineSha: string): string {
  return `git checkout ${baselineSha} -- packages/l1-config/`;
}
