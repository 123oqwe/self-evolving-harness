// L2-T15 · 包管理信任门 [V1]。
//
// Spec: execution/L2-memory-skills/TASKS.md §L2-T15（含 ERRATA-w2plus 裁决）。
//
// 包管理供应链安全边界（判 static-core 不进化）。source 类型集
// （npm/git/git-subdir/archive/command/local）、version pinning（semver +
// ref+sha + sha256）、trust gate（project-level skill 需显式 trust +
// find-skills <100 installs 警告）、never-auto-install-project。
// strip TOKEN/SECRET/KEY/AUTH env + filter routing headers。
//
// 设计铁律（02-memory-skills.md 组件 11）：
//   1. **信任门是供应链安全边界，判 static-core 不进化**——agent **绝不**
//      能改 trust gate，否则 agent 可关闭自己的安全门（R13 供应链风险）。
//   2. **project-level skill 必须显式 trust**——cloned repo 的
//      `.agents/skills/` 不可自动注入 untrusted instructions（防 prompt
//      injection 持久化）。
//   3. **never-auto-install-project**——任何自动安装 project skill 的调用
//      一律 reject（static-core）。
//
// REFACTOR 备注：spec 建议把 breakerScan 与 L2-T09b 共享于本文件。实际
// `breakerScan` 已在 `skill-evo/body-evo.ts` 实现并经 barrel 导出，本文件
// 仅 re-export 以满足 "trust/package-gate.ts 共享 breakerScan" 语义，避免
// 双重定义造成 barrel 冲突。

import type { MemCtx } from "../memory-tool/commands.js";
import { breakerScan, type BreakerFlag } from "../skill-evo/body-evo.js";

// ---------------------------------------------------------------------------
// 类型（spec 接口签名，字段名/可选性一字不差）
// ---------------------------------------------------------------------------

/**
 * PackageSource —— 包来源类型集。
 *
 * - `npm`：npm registry。
 * - `git`：git 仓库（含 ref+sha pinning）。
 * - `git-subdir`：git 仓库子目录。
 * - `archive`：tar/zip 归档（含 sha256）。
 * - `command`：本地命令安装。
 * - `local`：本地路径。
 */
export type PackageSource =
  | "npm"
  | "git"
  | "git-subdir"
  | "archive"
  | "command"
  | "local";

/**
 * PkgRef —— 包引用（含 source/specifier/version pinning/trust/installs）。
 */
export interface PkgRef {
  source: PackageSource;
  specifier: string;
  /** git ref 的 sha pinning（`git`/`git-subdir`）。 */
  sha?: string;
  /** archive 的 sha256 pinning。 */
  sha256?: string;
  /** project-level 显式 trust 声明（user 在 config 层签字）。 */
  trustDeclared: boolean;
  /** find-skills 安装数（<100 触发警告）。 */
  installs?: number;
}

/** 信任门通过。 */
export type Allow = { ok: true };

/**
 * 信任门拒绝原因（判别联合）。
 *
 * - `no_explicit_trust`：project-level skill 无显式 trust。
 * - `never_auto_install_project`：自动安装 project skill 被硬 reject。
 */
export interface PkgRejectReason {
  ok: false;
  reason: "no_explicit_trust" | "never_auto_install_project";
  msg: string;
}

// ---------------------------------------------------------------------------
// stripSecrets —— strip TOKEN/SECRET/KEY/AUTH/PASSWORD/CREDENTIAL env
// ---------------------------------------------------------------------------

/**
 * 匹配含敏感令牌关键字的 env key（case-insensitive 子串匹配）。
 *
 * 覆盖 spec GREEN 给出的 `/^(TOKEN|SECRET|KEY|AUTH|PASSWORD|CREDENTIAL).*$/i`
 * 起始锚定正则无法命中 `OPENAI_API_KEY`/`MY_SECRET`/`API_KEY` 等"敏感词在
 * 中段"的 key；本实现采用子串匹配以覆盖 CC 常见凭据命名约定
 * （`*_API_KEY`/`*_SECRET`/`*_TOKEN`/`*_AUTH_*`）。
 */
const SECRET_KEY_RE = /(TOKEN|SECRET|KEY|AUTH|PASSWORD|CREDENTIAL)/i;

/**
 * stripSecrets —— 从 env 字典中剥离含敏感令牌关键字的字段。
 *
 * 安全门：agent 把 env 注入子进程/skill scripts 前，必须先 strip，防止
 * 凭据经 env 泄漏到 untrusted skill 代码（R13 供应链 + prompt injection
 * 持久化）。
 *
 * @param env 原始 env 字典
 * @returns 剥离敏感字段后的 env 字典（新对象，不改原入参）
 */
export function stripSecrets(
  env: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (SECRET_KEY_RE.test(k)) continue;
    out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// trustGate —— project-level skill 需显式 trust + <100 installs 警告
// ---------------------------------------------------------------------------

/** find-skills 安装数警告阈值。 */
const LOW_INSTALLS_THRESHOLD = 100;

/**
 * trustGate —— 包管理信任门。
 *
 * 规则（spec 行为规范）：
 *   1. project-level skill `trustDeclared=false` → reject
 *      `no_explicit_trust`（防 cloned repo `.agents/skills/` 自动注入
 *      untrusted instructions）。
 *   2. project-level skill `trustDeclared=true` → allow。
 *   3. `installs < 100` → allow 但经 `ctx.warnings` 暴露 "<100 installs"
 *      警告（find-skills 低采用度信号，ERRATA-w2plus L2-05 side channel）。
 *   4. 非 project-level（hub/user-level）skill → allow（trust 不强制），
 *      仍走 <100 installs 警告。
 *
 * @param ref            PkgRef（source/specifier/trust/installs）
 * @param isProjectLevel 是否 project-level skill（cloned repo 来源）
 * @param ctx            可选 MemCtx（side channel warnings）
 * @returns allow → `{ ok: true }`；reject → `PkgRejectReason`
 */
export function trustGate(
  ref: PkgRef,
  isProjectLevel: boolean,
  ctx?: MemCtx,
): Allow | PkgRejectReason {
  // 规则 1：project-level skill 无显式 trust → reject
  if (isProjectLevel && !ref.trustDeclared) {
    return {
      ok: false,
      reason: "no_explicit_trust",
      msg: "project skill needs explicit trust",
    };
  }

  // 规则 3：<100 installs → warn（不阻塞 allow）
  if (typeof ref.installs === "number" && ref.installs < LOW_INSTALLS_THRESHOLD) {
    pushWarning(ctx, `skill has <100 installs (${ref.installs})`);
  }

  // 规则 2/4：trust 已声明或非 project-level → allow
  return { ok: true };
}

// ---------------------------------------------------------------------------
// neverAutoInstallProject —— 自动安装 project skill 硬 reject（static-core）
// ---------------------------------------------------------------------------

/**
 * neverAutoInstallProject —— 任何自动安装 project skill 的调用一律 reject。
 *
 * static-core 铁律（02-memory-skills.md 组件 11）：agent **绝不**能自动
 * 安装 project-level skill（cloned repo 的 `.agents/skills/`），否则
 * prompt injection 可经 `git clone` 持久化进 agent 上下文。project skill
 * 必须由 user 在 config 层显式 trust 后方可安装。
 *
 * @param _ref PkgRef（保留入参以与 trustGate 对齐；不消费——一律 reject）
 * @param _ctx 可选 MemCtx（保留入参；不消费）
 * @returns 永远返回 `PkgRejectReason{never_auto_install_project}`
 */
export function neverAutoInstallProject(
  _ref: PkgRef,
  _ctx?: MemCtx,
): PkgRejectReason {
  return {
    ok: false,
    reason: "never_auto_install_project",
    msg: "never auto-install project skill; explicit trust required",
  };
}

// ---------------------------------------------------------------------------
// breakerScan re-export（与 L2-T09b 共享，spec REFACTOR）
// ---------------------------------------------------------------------------

export { breakerScan, type BreakerFlag };

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/**
 * 向 `ctx.warnings` side channel 推一条警告（ERRATA-w2plus L2-05）。
 *
 * ctx 缺省或 warnings 未初始化时静默丢弃——trust 决策不因 side channel
 * 缺失而改变（allow 仍 allow，只丢警告可见性）。
 */
function pushWarning(ctx: MemCtx | undefined, msg: string): void {
  if (!ctx) return;
  if (!Array.isArray(ctx.warnings)) {
    (ctx as { warnings?: string[] }).warnings = [];
  }
  ctx.warnings!.push(msg);
}
