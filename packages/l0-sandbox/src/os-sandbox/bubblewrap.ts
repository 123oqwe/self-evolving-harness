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
      "--unshare-net",
      "--die-with-parent",
    ];
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
