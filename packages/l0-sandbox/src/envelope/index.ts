/**
 * L0S-T13 — C7 canary 扩充 / C / 阈值 / 灰度进化安全包络
 *
 * C7 进化层安全包络参数进化：
 *   - canary payload 扩充（新增 exfil 新模式 payload）；
 *   - archive 容量 C 单调调小（防自降门槛）；
 *   - acceptance 阈值单调调严；
 *   - 灰度比例 canaryRatio 进化（方向不纳入门）。
 *
 * 文件/模块布局：
 *   - `envelope/index.ts` — `EnvelopeRegistry`（本文件）
 *   - `envelope/monotonic.ts` — acceptance 单调调严 / C 单调调小守卫
 *   - `envelope/abc-audit.ts` — ABC checklist 审计（empty-response 不算 pass）
 *
 * ERRATA-w2plus L0S-T13：
 *   - `EnvelopeRegistry.assertIntegrity`（sha256 校验）须导出。
 *   - `CanaryResult` 形状裁定 `{ response: string; passed: boolean }`。
 *   - `assertMonotonicStricter` 允许相等（`>=`/`<=`，持平合法）；
 *     `canaryRatioDelta` 不纳入门（canaryRatio 可双向变化）。
 *   - 构造器支持 `{ capacity? }` 注入（archive 容量上限 DI）。
 *
 * 复用：bigpowers `gate-trace` 确定性 traceability 闸；ABC checklist（arXiv:2507.02825）。
 */

import { createHash } from "node:crypto";
import {
  assertMonotonicStricter,
  type EnvelopeDiff,
} from "./monotonic.js";
import {
  abcAudit,
  type CanaryResult,
  type AbcAuditResult,
} from "./abc-audit.js";

/** 安全包络参数（C7 进化层）。 */
export interface EnvelopeParams {
  /** 版本号。 */
  version: string;
  /** canary payload 列表（exfil/逃逸新模式）；sha256 锁定其内容。 */
  canaryPayloads: string[];
  /** archive 容量 C（单调调小）。 */
  archiveCapC: number;
  /** acceptance 阈值（单调调严）。 */
  acceptanceThreshold: number;
  /** 灰度比例（方向不纳入门）。 */
  canaryRatio: number;
  /** canaryPayloads 内容的 sha256（hex），锁定完整性。 */
  sha256: string;
}

/** EnvelopeRegistry 构造选项（DI；ERRATA：`{ capacity? }`）。 */
export interface EnvelopeRegistryOpts {
  /** archive 容量上限（可选；用于运行时容量门，单测不依赖）。 */
  capacity?: number;
}

/**
 * 安全包络注册表：
 *   - `diff(prev, next)`：计算包络参数差异；
 *   - `assertMonotonicStricter(diff, next)`：acceptance↑ only / C↓ only 方向门；
 *   - `assertIntegrity(params)`：canary payload sha256 完整性校验；
 *   - `abcAudit(canaryResults)`：ABC 审计（empty-response 不算 pass）。
 */
export class EnvelopeRegistry {
  /** archive 容量上限（可选；用于运行时容量门，单测不依赖）。 */
  private readonly capacity: number | undefined;
  private currentParams: EnvelopeParams | undefined;

  constructor(opts?: EnvelopeRegistryOpts) {
    this.capacity = opts?.capacity;
  }

  /**
   * 计算包络参数差异。
   *
   *   - canaryAdded = next.canaryPayloads - prev.canaryPayloads（集合差）；
   *   - cDelta = next.archiveCapC - prev.archiveCapC（负=收紧）；
   *   - acceptanceDelta = next.acceptanceThreshold - prev.acceptanceThreshold（正=调严）；
   *   - canaryRatioDelta = next.canaryRatio - prev.canaryRatio（不纳入门）。
   */
  diff(prev: EnvelopeParams, next: EnvelopeParams): EnvelopeDiff {
    const prevSet = new Set(prev.canaryPayloads);
    const canaryAdded = next.canaryPayloads.filter((p) => !prevSet.has(p));
    return {
      canaryAdded,
      cDelta: next.archiveCapC - prev.archiveCapC,
      acceptanceDelta: next.acceptanceThreshold - prev.acceptanceThreshold,
      canaryRatioDelta: next.canaryRatio - prev.canaryRatio,
    };
  }

  /**
   * 断言差异方向单调收紧：acceptance↑ only（`>=`）/ C↓ only（`<=`）；持平合法。
   * canaryRatioDelta 不检查（spec 未提及，不纳入门）。
   *
   * 接收 diff 与 next（与 ERRATA T08 风格一致：assertChangeAllowed 收 diff 与 next）。
   *
   * @throws acceptance 放宽 / C 放大
   */
  assertMonotonicStricter(diff: EnvelopeDiff, _next: EnvelopeParams): void {
    assertMonotonicStricter(diff);
  }

  /**
   * 断言 canary payload 完整性：`params.sha256` 须等于
   * `sha256(JSON.stringify(params.canaryPayloads))`。
   *
   * @throws sha256 不匹配（canary payload 被篡改）
   */
  assertIntegrity(params: EnvelopeParams): void {
    const expected = createHash("sha256")
      .update(JSON.stringify(params.canaryPayloads))
      .digest("hex");
    if (params.sha256 !== expected) {
      throw new Error(
        `canary payload sha256 mismatch: expected ${expected}, got ${params.sha256}`,
      );
    }
  }

  /**
   * ABC 审计：剔除 empty-response 假 pass。
   * empty-response 占比 > 0 → `pass=false`（τ-bench 38% 教训）。
   *
   * 注意：`CanaryResult`（`{ response, passed }`）与 T11 credential-policy 的
   * `CanaryResult`（`{ leaked }`）同名异构；本模块不通过 barrel 再导出
   * `CanaryResult` 以避免命名碰撞，调用方按结构传入即可。
   */
  abcAudit(canaryResults: CanaryResult[]): AbcAuditResult {
    return abcAudit(canaryResults);
  }

  /**
   * 提交 next 为 current（apply 路径）。
   *
   * 单调收紧守卫（fail-closed）：若已有 current params，须 prev→next diff
   * 经 assertMonotonicStricter（acceptance↑ only / C↓ only）。防 apply 路径
   * 静默接受放宽/回退包络参数绕过「只允许单调收紧」不变量。持平合法。
   *
   * @throws acceptance 放宽 / C 放大时 throw
   */
  commit(next: EnvelopeParams): EnvelopeParams {
    if (this.currentParams !== undefined) {
      const d = this.diff(this.currentParams, next);
      assertMonotonicStricter(d);
    }
    this.currentParams = next;
    return next;
  }

  /** 返回已注册 current params（须先 commit）。 */
  current(): EnvelopeParams {
    if (this.currentParams === undefined) {
      throw new Error("no envelope params committed: call commit(next) first");
    }
    return this.currentParams;
  }
}

export {
  assertMonotonicStricter,
  type EnvelopeDiff,
} from "./monotonic.js";
export { abcAudit } from "./abc-audit.js";
