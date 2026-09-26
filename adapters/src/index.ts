// @harness/adapters · package entry.
//
// ADP-T01: HarnessPort 适配器契约 + ReferenceAdapter（用 7 包作内建实现）。
// ADP-T02: PiAdapter + PiHeadlessLLM（pi harness 适配器）。
// ADP-T03: ClaudeCodeAdapter + exam-lock（Claude Code harness 适配器）。

export * from "./port.js";
export * from "./pi/pi-adapter.js";
export * from "./pi/headless-llm.js";
export * from "./claude-code/claude-code-adapter.js";
export * from "./claude-code/exam-lock.js";
