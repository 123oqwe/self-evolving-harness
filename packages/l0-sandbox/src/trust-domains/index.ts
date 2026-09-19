/**
 * L0S-T01 — brain/hands/session 三信任域边界接口（barrel）
 */

export type {
  Action,
  Observation,
  RunState,
  SessionEvent,
  LogEntry,
} from "../actions/protocol.js";
export { ToolUseIdDedup } from "../actions/dedup.js";
export {
  createBrain,
  type BrainDomain,
  type CmdRunner,
  type CreateBrainOpts,
  UNKNOWN_TARGET,
} from "./brain.js";
export {
  createHands,
  type HandsDomain,
  HANDS_UNAVAILABLE,
  UNSUPPORTED_ACTION,
} from "./hands.js";
export {
  createSessionLog,
  type SessionLogDomain,
} from "./session-log.js";
