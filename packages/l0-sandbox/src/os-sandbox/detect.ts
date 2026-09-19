/**
 * L0S-T02 — 平台探测 + 后端选择
 *
 * 顺序：darwin + sandbox-exec → Seatbelt；linux + bwrap → Bubblewrap；
 * 否则 NoneBackend（runVerify 仍执行，sandbox_bypassed=true，平台门控 skip）。
 */

import { spawnSync } from "node:child_process";
import { BubblewrapBackend } from "./bubblewrap.js";
import { NoneBackend } from "./none.js";
import { SeatbeltBackend } from "./seatbelt.js";
import type { OssandboxBackend } from "./types.js";

/** `command -v <name>` 探测 PATH 中是否存在二进制。 */
function hasBinary(name: string): boolean {
  const r = spawnSync("sh", ["-c", `command -v ${name}`], {
    stdio: "ignore",
  });
  return r.status === 0;
}

/** 探测当前平台可用的 OS sandbox 后端；无后端返回 NoneBackend。 */
export function detect(): OssandboxBackend {
  if (process.platform === "darwin" && hasBinary("sandbox-exec")) {
    return new SeatbeltBackend();
  }
  if (process.platform === "linux" && hasBinary("bwrap")) {
    return new BubblewrapBackend();
  }
  return new NoneBackend();
}
