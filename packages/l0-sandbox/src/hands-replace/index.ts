/**
 * L0S-T12 — C6 hands 工具实现替换 + token TTL/scope 进化
 *            （能力 exit + 安全 EPERM 双验证器，held-out + 人工签发）
 *
 * C6 hands 工具实现可替换（接口契约 `execute(name,input)->string` 不变）+ token
 * TTL/scope 进化（02-sandbox-security C6）。替换经 held-out + 人工签发；双验证器 =
 * 能力 exit + 安全 EPERM。
 *
 * 文件/模块布局：
 *   - `hands-replace/index.ts` — `HandsReplacementRegistry`（本文件）
 *   - `hands-replace/dual-verifier.ts` — 能力 exit + 安全 EPERM 双验证器
 *
 * ERRATA L0S-T12：
 *   - `HandsReplacementRegistry` 构造器注入 `{ trustedSigners, verifySignoff, escapeSuite }`。
 *   - `assertContract`「execute returns string」与 `impl: (action) => Promise<Observation>`
 *     矛盾——裁定：接口契约 `execute(name,input)->string` 映射到 `Observation.content: string`；
 *     `assertContract` 运行时校验 impl 形状 + 同步探针返回 Observation.content 为 string。
 *   - `replace` 的 heldOut 能力通过判据 = exit 0（任务 verify exit 0）。
 *
 * 复用：T08 `ChangeSignoff`（人工签发 gate，结构化 expectedChange=`"replace <name>"`）；
 *       T01 `Action`/`Observation` 协议。
 */

import {
  ChangeSignoff,
  type ChangeSignoffOpts,
  type Signoff,
  type VerifySignoffFn,
} from "../net-policies/signoff.js";
import type { Action, Observation } from "../actions/protocol.js";
import {
  verifyCapability,
  verifySecurity,
  type DualVerifyResult,
} from "./dual-verifier.js";

/** hands 工具实现替换件。 */
export interface HandsImpl {
  /** 工具名（如 "bash"）。 */
  name: string;
  /** 替换件版本。 */
  version: string;
  /**
   * 实现函数：execute(name,input)->string wire 契约映射到 Observation.content: string。
   * 类型签名为 `(action) => Promise<Observation>`；`assertContract` 同步探针额外校验
   * 同步返回 Observation.content 为 string（见 ERRATA 裁决）。
   */
  impl: (action: Action) => Promise<Observation>;
  /** 人工签发记录（覆盖 `replace <name>` 变更）。 */
  signoffs: Signoff[];
}

/** HandsReplacementRegistry 构造选项（DI）。 */
export interface HandsReplacementRegistryOpts {
  /** 可信签发人 allowlist。 */
  trustedSigners: string[];
  /** 可注入的签发验证函数（缺省 fail-closed，须注入真实 ssh-keygen -Y verify）。 */
  verifySignoff?: VerifySignoffFn;
  /** 逃逸套件（安全验证器输入）。 */
  escapeSuite: Action[];
}

/**
 * hands 实现替换注册表：
 *   - `assertContract(newImpl)`：运行时校验 wire 契约 `execute(name,input)->string`
 *     不变（impl 为函数 + 同步探针返回 Observation.content 为 string）。
 *   - `replace(name, newImpl, heldOut)`：人工签发 gate + 双验证器（能力 exit +
 *     安全 EPERM），返回 `{ capabilityPass, securityPass }`；无签发 throw。
 */
export class HandsReplacementRegistry {
  private readonly signoff: ChangeSignoff;
  private readonly escapeSuite: Action[];

  constructor(opts?: HandsReplacementRegistryOpts) {
    this.escapeSuite = opts?.escapeSuite ?? [];
    if (opts) {
      const signoffOpts: ChangeSignoffOpts = {
        trustedSigners: opts.trustedSigners,
      };
      if (opts.verifySignoff !== undefined) {
        signoffOpts.verifySignoff = opts.verifySignoff;
      }
      this.signoff = new ChangeSignoff(signoffOpts);
    } else {
      // 无参构造（contract 测试用）：签发 gate fail-closed（trustedSigners 空），
      // assertContract 不依赖签发/逃逸套件。
      this.signoff = new ChangeSignoff({ trustedSigners: [] });
    }
  }

  /**
   * 断言 wire 契约 `execute(name,input)->string` 不变：
   *   - `impl` 须为函数；
   *   - `name`/`version` 须为 string；
   *   - 同步探针调用 `impl(probeAction)`，返回值须为同步 Observation 且
   *     `content` 为 string（async/Promise 返回或 content 非 string → throw）。
   *
   * @throws impl 不是函数 / 探针返回 Promise / content 非 string
   */
  assertContract(newImpl: HandsImpl): void {
    if (typeof newImpl.impl !== "function") {
      throw new Error(
        "HandsImpl.impl must be a function (execute(name,input)->string wire contract)",
      );
    }
    if (
      typeof newImpl.name !== "string" ||
      typeof newImpl.version !== "string"
    ) {
      throw new Error("HandsImpl.name/version must be strings");
    }
    // 运行时探针：wire 契约 execute(name,input)->string → Observation.content 须为 string。
    // 同步调用 impl；async impl 返回 Promise（.content undefined）→ 视为破坏同步 wire 契约。
    const probe: Action = {
      type: "cmd_run",
      tool_use_id: "__contract_probe__",
      command: "",
      timeout_ms: 0,
    };
    const result = newImpl.impl(probe) as unknown;
    if (
      result != null &&
      typeof (result as { then?: unknown }).then === "function"
    ) {
      throw new Error(
        "HandsImpl.impl must synchronously return Observation with content: string " +
          "(execute->string wire contract); async/Promise return rejected by assertContract",
      );
    }
    const obs = result as Observation;
    if (obs == null || typeof obs.content !== "string") {
      throw new Error(
        "HandsImpl.impl must return Observation with content: string",
      );
    }
  }

  /**
   * 替换 hands 实现：人工签发 gate + 双验证器。
   *
   *   1. 签发 gate：`newImpl.signoffs` 须含可信签发人覆盖 `replace <name>` 变更
   *      （无签发 → throw，须人工签发）；
   *   2. 能力验证器：held-out 任务集跑 newImpl，全部 exit 0 → capabilityPass=true；
   *   3. 安全验证器：逃逸套件跑 newImpl，全部被拒（EPERM/exit != 0）→ securityPass=true。
   *
   * 不在替换阶段调用 `assertContract`（assertContract 为同步 wire 契约门，async impl
   * 由双验证器以真实 action 验证能力/安全）。安全退化（securityPass=false）不 throw，
   * 由调用方据返回值裁定 reject。
   *
   * @throws 无可信签发覆盖 `replace <name>`
   */
  async replace(
    name: string,
    newImpl: HandsImpl,
    heldOut: Action[],
  ): Promise<DualVerifyResult> {
    // 1. 人工签发 gate：替换须可信签发人签发（结构化 expectedChange = "replace <name>"）。
    this.signoff.assertSigned(newImpl.signoffs, `replace ${name}`);
    // 2. 能力验证器：held-out 任务集 exit 0。
    const capabilityPass = await verifyCapability(newImpl.impl, heldOut);
    // 3. 安全验证器：逃逸套件 EPERM。
    const securityPass = await verifySecurity(newImpl.impl, this.escapeSuite);
    return { capabilityPass, securityPass };
  }
}

export { verifyCapability, verifySecurity, type DualVerifyResult } from "./dual-verifier.js";
