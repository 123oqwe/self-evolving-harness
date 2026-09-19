/**
 * L0S-T01 — 类型化 Action / Observation 协议（discriminated union + tool_use_id 配对）
 *
 * 单一 choke point EventStream 的 wire schema。所有 brain→hands 调用经此协议；
 * `tool_use_id` 配对保证 replay 确定性（同一 tool_use_id 重放返回同一 Observation）。
 */

/** 受信 brain 域可向 hands 域发起的 typed action 集合。 */
export type Action =
  | { type: "cmd_run"; tool_use_id: string; command: string; timeout_ms: number }
  | { type: "file_edit"; tool_use_id: string; path: string; old_str: string; new_str: string }
  | { type: "ipython_run_cell"; tool_use_id: string; code: string }
  | { type: "browse_url"; tool_use_id: string; url: string };

/** hands 域返回的 observation。`content` 语义见裁决 L0S-T01-A8（cmd_run: content === stdout）。 */
export interface Observation {
  tool_use_id: string;
  content: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  error?: string;
}

/**
 * RunState —— 与 L0C-T07a RunStateSchema 结构对齐。
 *
 * 跨模块契约：L0S `wake(sessionId)` 返回的 RunState 必须可被 L0C
 * `serializeRunState/deserializeRunState` 序列化。字段集 = L0C-T07a RunStateSchema：
 * version / current_agent / _current_turn / pending_input /
 * unsent_tool_call_ids_for_interrupted_state / approvals / turnItems[]。
 *
 * 注：L0C-T07a 尚未落地（l0-core 为 scaffold 占位），此处按 spec 字段集本地定义，
 * 待 L0C-T07a 落地后切换为 `import("@harness/l0-core").RunState`（结构兼容）。
 */
export interface RunState {
  version: string;
  current_agent: string;
  _current_turn: number;
  pending_input: unknown;
  unsent_tool_call_ids_for_interrupted_state: string[];
  approvals: Record<string, unknown>;
  turnItems: unknown[];
}

/** Session 事件（裁决补定义 L0S-T01-A3/A4/A5）。 */
export interface SessionEvent {
  /** 事件类型字面量，如 'hands_crashed' / 'cache_prefix_violation' */
  type: string;
  sessionId: string;
  /** Date.now() 毫秒 */
  ts: number;
  payload?: unknown;
}

/** LogEntry —— 与 L0C-T07b WRITE DELTA journal 对齐。 */
export interface LogEntry {
  seq: number;
  tool_use_id: string;
  action: Action;
  observation: Observation;
  /** Date.now() 毫秒 */
  timestamp: number;
}
