/**
 * L0S-T02 — Linux bubblewrap (`bwrap`) + seccomp 后端
 *
 * `bwrap --ro-bind / / --bind <cwd> <cwd> --unshare-net` 实现只读根 + 可写工作区
 * + 全断网。denyRead 路径用 mode-000 遮蔽源 bind 挂载产出 EPERM-family（裁决
 * A5：不得产出 ENOENT——bind /dev/null 会让 read 静默返回空/ENOENT，而非拒绝）。
 * 本平台（macOS）不执行该后端；Linux CI 上由 detect() 选中。
 *
 * epermHits 只从 stderr 真实存在的内核拒绝签名行提取；无关失败原样透传，
 * 不伪造合成拒绝记录（round 2 缺陷 3，与 seatbelt 同步）。
 *
 * 注：allowlist proxy 绑定在 T04a 完善；seccomp 精细化在 T07。
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runShell } from "./spawn.js";
import type {
  FsRules,
  NetRules,
  OssandboxBackend,
  RunVerifyOptions,
  VerifyResult,
} from "./types.js";

const EPERM_RE = /Operation not permitted|EPERM|Permission denied/i;

// ---------------------------------------------------------------------------
// CLN-T03 — static-core hardened bwrap argv (monotonic tightening)
//
// ERRATA-w01 §L0S-R1：Linux CI 以 root uid 运行时 bwrap mode-000 遮蔽失效
// （root 绕过文件权限）。缓解 (b)：bwrap 启动固定追加 `--cap-drop ALL`，
// 与现有 `--unshare-net` / `--die-with-parent` 叠加。此为 static-core 收紧
// 方向（WBS §3.2 L0S-T07 单调收紧不变量）：config 不可移除其中任何一项，
// 否则触发 breaker clause（`StaticCoreTamperError`，与 L0C-T10 同源）。
// ---------------------------------------------------------------------------

/**
 * 硬编码、不可被 config 移除的 bwrap 收紧参数。frozen 防运行时篡改。
 *
 * 注：`--unshare-net` / `--die-with-parent` 沿用 L0S-T02 既有契约；
 * `--cap-drop ALL` 为 CLN-T03 新增（L0S-R1 缓解）。
 */
export const BWRAP_HARDENED_ARGS: readonly string[] = Object.freeze([
  "--unshare-net",
  "--die-with-parent",
  "--cap-drop ALL",
]);

/**
 * static-core 篡改错误（breaker clause）。任何试图放宽 `BWRAP_HARDENED_ARGS`
 * （移除收紧参数）的 config 都被拒绝。与 WBS §3.1 L0C-T10 breaker 同源
 * 字面量，message 始终含 `breaker` + `static-core` 以便集成场景匹配。
 */
export class StaticCoreTamperError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "StaticCoreTamperError";
    Object.setPrototypeOf(this, StaticCoreTamperError.prototype);
  }
}

/** `buildBwrapArgs` 的 config 形状。`removeHardened` 试图移除的收紧参数。 */
export interface BwrapArgsConfig {
  /** 试图从 `BWRAP_HARDENED_ARGS` 移除的参数列表（breaker 拒绝任何命中）。 */
  readonly removeHardened?: readonly string[];
}

/**
 * 构造 bwrap 启动 argv（默认收紧路径）。导出供 CLN-T03 锁定测试与未来
 * canary/verifier 二次校验消费。`config.removeHardened` 试图移除任一
 * `BWRAP_HARDENED_ARGS` 元素 → throw `StaticCoreTamperError`（breaker）。
 */
export function buildBwrapArgs(config?: BwrapArgsConfig): string[] {
  const removeHardened = config?.removeHardened ?? [];
  for (const h of BWRAP_HARDENED_ARGS) {
    if (removeHardened.includes(h)) {
      throw new StaticCoreTamperError(
        `breaker: static-core bwrap hardened arg '${h}' cannot be removed ` +
          `(monotonic tightening, WBS §3.2 L0S-T07 / CLN-T03 L0S-R1)`,
      );
    }
  }
  const args: string[] = ["bwrap"];
  args.push(...BWRAP_HARDENED_ARGS);
  args.push(
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--",
    "sh",
    "-c",
    "true",
  );
  return args;
}

/**
 * 为每条 denyRead 路径准备一个 mode-000 的遮蔽源（目录或文件，按目标类型），
 * 供 --ro-bind 覆盖到目标路径上：任何 open/traversal 都被内核权限检查拒绝
 * （EACCES → "Permission denied"），是真实的内核强制拒绝而非静默替换。
 * 返回 { source, target } 对；staging 根目录由调用方在 finally 中清理。
 */
function createDenyReadShadows(
  denyRead: string[],
  staging: string,
): { source: string; target: string }[] {
  return denyRead.map((p, i) => {
    let isFile = false;
    try {
      isFile = statSync(p).isFile();
    } catch {
      /* 目标不存在 → 按目录遮蔽（对其中将来的路径同样 EACCES）。 */
    }
    if (isFile) {
      const shadowFile = join(staging, `shadow-${i}`);
      writeFileSync(shadowFile, "", { mode: 0 });
      chmodSync(shadowFile, 0);
      return { source: shadowFile, target: p };
    }
    const source = join(staging, `shadow-${i}`);
    mkdirSync(source, { mode: 0 });
    return { source, target: p };
  });
}

export class BubblewrapBackend implements OssandboxBackend {
  readonly platform = "linux-bwrap" as const;

  buildArgs(
    cmd: string,
    fsRules: FsRules,
    _netRules: NetRules,
    cwd: string,
    denyReadShadows: { source: string; target: string }[] = [],
  ): string[] {
    const args: string[] = [
      "bwrap",
      "--ro-bind",
      "/",
      "/",
      "--bind",
      cwd,
      cwd,
      "--dev",
      "/dev",
      "--proc",
      "/proc",
    ];
    // CLN-T03：硬编码收紧参数（含 `--cap-drop ALL`）——config 不可移除，
    // 见 `BWRAP_HARDENED_ARGS` / breaker 守卫。
    args.push(...BWRAP_HARDENED_ARGS);
    // denyRead：mode-000 遮蔽源 --ro-bind 到目标路径，open 产出 EACCES/EPERM
    // （裁决 A5：真实内核拒绝，非 ENOENT）。
    for (const { source, target } of denyReadShadows) {
      args.push("--ro-bind", source, target);
    }
    args.push("--", "sh", "-c", cmd);
    return args;
  }

  async runVerify(cmd: string, opts: RunVerifyOptions): Promise<VerifyResult> {
    const staging = mkdtempSync(join(tmpdir(), "l0s-t02-denyread-"));
    try {
      const shadows = createDenyReadShadows(
        opts.fsRules.denyRead,
        staging,
      );
      const argv = this.buildArgs(
        cmd,
        opts.fsRules,
        opts.netRules,
        opts.cwd,
        shadows,
      );
      const res = await runShell(argv, {
        cwd: opts.cwd,
        timeout_ms: opts.timeout_ms,
      });

      // 只记录 stderr 中真实存在的内核拒绝签名；无关失败原样透传（缺陷 3）。
      const epermHits: string[] = [];
      for (const line of res.stderr.split("\n")) {
        if (EPERM_RE.test(line)) epermHits.push(line);
      }

      return {
        exitCode: res.exitCode,
        stdout: res.stdout,
        stderr: res.stderr,
        epermHits,
      };
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }
}
