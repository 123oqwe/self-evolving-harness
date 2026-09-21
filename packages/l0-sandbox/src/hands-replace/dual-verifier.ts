/**
 * L0S-T12 — 双验证器（能力 exit + 安全 EPERM）
 *
 * C6 hands 工具实现替换经 held-out + 人工签发；双验证器在 promote 前并行跑：
 *   - 能力验证器：held-out 任务集（代表性工作负载）跑 newImpl，全部 exit 0 才通过
 *     （防 false-deny 正常工作负载——不能只用逃逸套件判定替换合法性）；
 *   - 安全验证器：逃逸套件（`~/.ssh` 读 / egress evil / metadata / …）跑 newImpl，
 *     全部被拒（exit != 0 / EPERM）才通过（防安全退化，如 `~/.ssh` 可读）。
 *
 * 双绿才 promote；任一红则 reject 或返回对应 pass=false（由 registry 裁定 throw 与否）。
 *
 * refix1 安全加固：
 *   - 安全判据 fail-closed：`denied = exit_code !== 0 || error === "EPERM" ||
 *     /EPERM|not permitted/i.test(stderr)`。exit 0 + 非空内容（如 PRIVATE KEY MATERIAL）
 *     → denied=false → securityPass=false（防逃逸 payload 放行）。
 */

import type { Action, Observation } from "../actions/protocol.js";
import type { HandsImpl } from "./index.js";

/** 双验证器结果。 */
export interface DualVerifyResult {
  capabilityPass: boolean;
  securityPass: boolean;
}

/**
 * 能力验证器：held-out 任务集跑 newImpl，全部 exit 0 才通过。
 *
 * held-out 须含能力代表性任务（不能只用逃逸套件，否则 false-deny 正常工作负载）。
 * 任一任务 exit_code !== 0 → capabilityPass=false。
 */
export async function verifyCapability(
  impl: HandsImpl["impl"],
  heldOut: Action[],
): Promise<boolean> {
  for (const action of heldOut) {
    const obs: Observation = await impl(action);
    if (obs.exit_code !== 0) {
      return false;
    }
  }
  return true;
}

/**
 * 安全验证器：逃逸套件跑 newImpl，全部被拒才通过。
 *
 * 拒绝判据（fail-closed）：exit_code !== 0 || error === "EPERM" ||
 * stderr 命中 /EPERM|not permitted/i。逃逸 payload 放行（exit 0 + 内容返回）
 * → securityPass=false。
 */
export async function verifySecurity(
  impl: HandsImpl["impl"],
  escapeSuite: Action[],
): Promise<boolean> {
  for (const action of escapeSuite) {
    const obs: Observation = await impl(action);
    const denied =
      obs.exit_code !== 0 ||
      obs.error === "EPERM" ||
      /EPERM|not permitted/i.test(obs.stderr);
    if (!denied) {
      return false;
    }
  }
  return true;
}
