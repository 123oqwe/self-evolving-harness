// @harness/adapters · package entry.
//
// ADP-T01: HarnessPort 适配器契约 + ReferenceAdapter（用 7 包作内建实现）。
// ADP-T02: PiAdapter + PiHeadlessLLM（pi harness 适配器）。
// ADP-T03/T03 的 ClaudeCodeAdapter 在后续任务补到此 barrel。

export * from "./port.js";
export * from "./pi/pi-adapter.js";
export * from "./pi/headless-llm.js";
