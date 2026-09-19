// CE-T02 REFACTOR: sandbox 调用适配器 —— 构造 L0S-T02 RunVerifyOptions 默认值。
//
// CE-T02 的 sandbox 适配必须走 L0S-T02 `runVerify`（不是 L0S-T01 `execute`）。
// 本模块只构造 opts，不重写 sandbox 原语；真实 sandbox 后端由调用方注入
// （SeatbeltBackend / BubblewrapBackend / NoneBackend，均实现 OssandboxBackend）。

import type { RunVerifyOptions } from "@harness/l0-sandbox";
import type { CanaryTask } from "./canary/types.js";

/**
 * 构造 L0S-T02 RunVerifyOptions 默认值。
 *
 * CE 侧不持有 sandbox 策略表（fs profile / allowedDomains / denyOut V2 进化），
 * 此处给出最小安全默认：全断网 deny-default（T02 阶段）+ 空 fs 规则
 * （真实 fsRules 由调用方/L0S-T03 注入；CE 仅消费 RunVerifyOptions 形状）。
 */
export function buildDefaultRunVerifyOptions(
  _task: CanaryTask,
): RunVerifyOptions {
  return {
    cwd: process.cwd(),
    timeout_ms: 30_000,
    fsRules: {
      allowWrite: [],
      denyWrite: [],
      denyRead: [],
      allowRead: [],
    },
    netRules: {
      allowedDomains: [],
      denyOutCidr: [],
    },
  };
}
