/**
 * L0S-T11 — canary 泄漏率=0 零容忍门
 *
 * policy promote 前必须跑 T05 `CanaryLeakVerifier`，将结果交本门裁决。
 * canary 泄漏率零容忍：`canaryResult.leaked === true` → throw，reject 该 policy。
 * 泄漏率=0 是 C5 安全不变量，任何非零泄漏都视为凭据策略退化，不得放行。
 */

import type { CredentialPolicy } from "./index.js";

/** canary 验证结果（由 T05 CanaryLeakVerifier 产出）。 */
export interface CanaryResult {
  /** 是否发生凭据泄漏（true = 泄漏，零容忍 reject）。 */
  leaked: boolean;
}

/**
 * canary 零容忍门：policy 变更后 canary 必须零泄漏。
 *
 * @param _policy 待 promote 的 policy（保留参数以明示门作用于哪个 policy）
 * @param canaryResult T05 验证器结果
 * @throws canaryResult.leaked === true 时 throw（reject policy）
 */
export function assertCanaryZero(
  _policy: CredentialPolicy,
  canaryResult: CanaryResult,
): void {
  if (canaryResult.leaked) {
    throw new Error(
      "canary leak detected (leaked=true): C5 zero-tolerance violated, " +
        "policy rejected (canary 泄漏率=0 零容忍)",
    );
  }
}
