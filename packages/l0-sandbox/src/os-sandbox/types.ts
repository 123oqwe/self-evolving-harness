/**
 * L0S-T02 — OS sandbox 原语适配器 · 类型契约
 *
 * 内核强制限制包（macOS Seatbelt / Linux bubblewrap+seccomp）的统一接口。
 * 原语本体 static-core；策略表（fs profile / allowedDomains / denyOut）V2 进化。
 *
 * 裁决 L0S-T02-A1：VerifyResult 扩展 `sandboxBypassed?` 字段。
 *   - NoneBackend.runVerify 返回 `sandboxBypassed=true`；
 *   - 真实后端返回 `undefined`（字段缺省）。
 */

/** 后端平台标识。`none` 表示无可信 OS 沙箱后端。 */
export type SandboxPlatform = "darwin-seatbelt" | "linux-bwrap" | "none";

/** 文件系统隔离规则（路径前缀）。T03 负责解析/优先级；T02 仅消费。 */
export interface FsRules {
  allowWrite: string[];
  denyWrite: string[];
  denyRead: string[];
  allowRead: string[];
}

/** 网络出口隔离规则。T04a 负责判定；T02 阶段为全断网 deny-default。 */
export interface NetRules {
  allowedDomains: string[];
  denyOutCidr: string[];
}

/** canary verify 命令隔离执行的返回结果。 */
export interface VerifyResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** 被内核/沙箱拒绝的 syscall 记录（EPERM-family）。 */
  epermHits: string[];
  /** 无后端 fallback 执行时为 true，供 CE 标记 sandbox_bypassed（裁决 A1）。 */
  sandboxBypassed?: boolean;
}

export interface RunVerifyOptions {
  cwd: string;
  timeout_ms: number;
  fsRules: FsRules;
  netRules: NetRules;
}

/** OS sandbox 后端统一接口（strategy pattern）。 */
export interface OssandboxBackend {
  readonly platform: SandboxPlatform;
  runVerify(
    cmd: string,
    opts: RunVerifyOptions,
  ): Promise<VerifyResult>;
}
