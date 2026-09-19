/**
 * L0S-T02 — OS sandbox 原语适配器（barrel）
 *
 * 统一接口 OssandboxBackend + macOS Seatbelt / Linux bubblewrap / 无后端 fallback。
 */

export type {
  SandboxPlatform,
  FsRules,
  NetRules,
  VerifyResult,
  RunVerifyOptions,
  OssandboxBackend,
} from "./types.js";
export { SeatbeltBackend } from "./seatbelt.js";
export { BubblewrapBackend } from "./bubblewrap.js";
export { NoneBackend } from "./none.js";
export { detect } from "./detect.js";
