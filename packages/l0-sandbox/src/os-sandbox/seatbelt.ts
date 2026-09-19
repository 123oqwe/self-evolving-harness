/**
 * L0S-T02 — macOS Seatbelt (sandbox-exec) 后端
 *
 * 生成 .sb profile：allow-default + 显式 deny（file-read / file-write subpath
 * + deny network）。deny 路径须用 fs.realpath 解析后再入 profile——macOS 上
 * /tmp 等是 symlink（/tmp → /private/tmp），Seatbelt subpath 匹配以内核解析后
 * 的规范路径为准，未解析的 deny 前缀不生效（防 bypass）。
 *
 * 裁决 A4：cmd 经 sh -c 执行，解析 PATH 中的 cat/curl/echo。
 * 裁决 A5：denyRead 产出 EPERM-family，不得产出 ENOENT。Seatbelt 的 deny file-read
 *   命中后内核对 open() 返回 EPERM，工具（cat）回显 "Operation not permitted"。
 *
 * 网络拒绝语义 surfacing：逃逸门硬约束（spec）要求 stderr 含拒绝语义（EPERM /
 * Operation not permitted）。epermHits 只从子进程 stderr 中真实存在的内核拒绝
 * 签名行（EPERM / Operation not permitted / Permission denied）提取；命令因
 * 无关原因失败（stderr 无拒绝签名）时结果原样透传，绝不伪造 "sandbox: egress
 * denied" 之类的合成拒绝记录——合成记录会把无关失败误标为沙箱拒绝，污染
 * CE 的 eperm 证据链。
 *
 * 嵌套沙箱（nested seatbelt）fail-closed：当本进程已处于 seatbelt 沙箱内
 * （如 harness 自身被外层 OS sandbox 包裹）时，macOS 内核拒绝嵌套 apply——
 * sandbox-exec 以 exit 71 / `sandbox_apply: Operation not permitted` 失败，
 * 与 profile 语法无关（最小 profile (version 1)(allow default) 同样被拒；
 * 真正的语法错误是 exit 65 + `unbound variable`）。此时 seatbelt 层无法为
 * 子进程新建沙箱，处理策略（fail-closed）:
 *   1. 无任何规则需要强制（denyRead/denyWrite 全空，且无网络约束——
 *      allowedDomains 与 denyOutCidr 均空；sealed 路径无条件 (deny network*)，
 *      故任一非空即视为需强制网络隔离）：
 *      命令在继承的父沙箱内直接执行，sandboxBypassed=true 诚实标注；
 *   2. 存在需要强制的规则: 拒绝执行（fail-closed，exit 126）——绝不在
 *      无强制隔离的环境里运行 canary 命令。stderr/epermHits surfacing 拒绝
 *      记录（含路径），统一带 [nested-unenforceable] 前缀，与真实内核拒绝
 *      签名明确区分。
 *
 * 嵌套判定防投毒（round 2 缺陷 1）：不可信命令可自行 `echo
 * 'sandbox_apply: Operation not permitted' >&2; exit 71` 伪造 apply 失败签名，
 * 诱使后端误判嵌套 → 命令被二次执行（先沙箱内再裸奔）+ 进程级缓存永久降级。
 * 防线：
 *   a. apply 失败判定三重校验，缺一不可：exitCode===71 && stdout==="" &&
 *      stderr 匹配 APPLY_DENIED_RE；
 *   b. 三重校验命中后仍不信任用户命令的输出——用我们自己控制的探针
 *      （固定路径 /usr/bin/true + 最小 profile (version 1)(allow default)，
 *      绝不执行用户命令）复测：探针同样三重命中才确认嵌套；探针成功则证明
 *      apply 在本环境可用，用户命令确已在沙箱内执行过一次，其结果原样返回
 *      （不重跑、不降级缓存）。
 */

import { realpathSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
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
 * sandbox-exec 自身 apply 失败签名：进程已在 seatbelt 沙箱内时，内核拒绝
 * 嵌套 apply（sandbox_apply → EPERM，退出码 71）。子命令本身不会被 exec。
 */
const APPLY_DENIED_RE = /sandbox_apply:\s*Operation not permitted/;

/** sandbox-exec apply 被内核拒绝时的退出码（嵌套沙箱签名之一）。 */
const APPLY_DENIED_EXIT = 71;

/** 嵌套探测用的最小 profile（无任何 deny 规则；语法错误时 exit 65，可区分）。 */
const PROBE_PROFILE = "(version 1)\n(allow default)\n";

/** 嵌套探测命令：固定路径 /usr/bin/true，绝不执行用户命令。 */
const PROBE_BIN = "/usr/bin/true";

/**
 * 进程级缓存：null = 未探测；true = 探针确认本进程处于嵌套沙箱（任何 profile
 * 的 apply 都被拒）。仅在探针确认后才置 true——用户命令输出永不足以置位。
 */
let nestedSandboxDetected: boolean | null = null;

/**
 * sandbox-exec apply 被内核拒绝的三重签名（缺一不可）：
 * exit 71 + stdout 为空（被拒的 apply 不会执行子命令）+ stderr 匹配
 * APPLY_DENIED_RE。单独 grep stderr 会被不可信命令投毒（round 2 缺陷 1）。
 */
function isApplyDenied(res: {
  exitCode: number;
  stdout: string;
  stderr: string;
}): boolean {
  return (
    res.exitCode === APPLY_DENIED_EXIT &&
    res.stdout === "" &&
    APPLY_DENIED_RE.test(res.stderr)
  );
}

/** 解析为规范绝对路径；不存在则退回 path.resolve（防 bypass）。 */
function resolveAbs(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolvePath(p);
  }
}

/** Seatbelt profile 字符串转义（双引号/反斜杠）。 */
function escapeSb(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export class SeatbeltBackend implements OssandboxBackend {
  readonly platform = "darwin-seatbelt" as const;

  /** 生成 sandbox-exec profile 字符串。 */
  buildProfile(fsRules: FsRules, _netRules: NetRules): string {
    const lines: string[] = ["(version 1)", "(allow default)"];

    // denyRead 同时禁止 read+write（spec 裁决 L0S-T03-A5：denyRead 隐含 denyWrite）。
    for (const p of fsRules.denyRead) {
      const abs = resolveAbs(p);
      lines.push(`(deny file-read* (subpath "${escapeSb(abs)}"))`);
      lines.push(`(deny file-write* (subpath "${escapeSb(abs)}"))`);
    }
    for (const p of fsRules.denyWrite) {
      const abs = resolveAbs(p);
      lines.push(`(deny file-write* (subpath "${escapeSb(abs)}"))`);
    }

    // T02 阶段：网络全断网 deny-default（socat allowlist proxy 在 L0S-T04a 实现）。
    lines.push("(deny network*)");

    return lines.join("\n") + "\n";
  }

  async runVerify(cmd: string, opts: RunVerifyOptions): Promise<VerifyResult> {
    if (nestedSandboxDetected !== true) {
      const result = await this.runVerifySealed(cmd, opts);
      if (result) return result;
    }
    return this.runVerifyNested(cmd, opts);
  }

  /**
   * 嵌套探测：用我们自己的最小 profile + 固定路径 /usr/bin/true 复测 apply。
   * 探针命令与用户命令零关联——其输出不可能被用户命令投毒，是嵌套判定的
   * 唯一权威证据。结果进程级缓存（进程的嵌套状态生命周期内不变）。
   */
  private async probeNestedSandbox(cwd: string): Promise<boolean> {
    const res = await runShell(["sandbox-exec", "-p", PROBE_PROFILE, PROBE_BIN], {
      cwd,
      timeout_ms: 10_000,
    });
    return isApplyDenied(res);
  }

  /** 正常路径：sandbox-exec 应用 profile 执行。返回 null 表示 apply 被拒（嵌套沙箱）。 */
  private async runVerifySealed(
    cmd: string,
    opts: RunVerifyOptions,
  ): Promise<VerifyResult | null> {
    const profile = this.buildProfile(opts.fsRules, opts.netRules);
    // sandbox-exec -p <profile> sh -c <cmd>
    const argv = ["sandbox-exec", "-p", profile, "sh", "-c", cmd];
    const res = await runShell(argv, {
      cwd: opts.cwd,
      timeout_ms: opts.timeout_ms,
    });

    // sandbox-exec 自身 apply 失败——仅当三重签名（exit 71 + stdout 空 + stderr
    // 匹配）全中才进入歧义消解。三重签名既可能是真实的嵌套 apply 拒绝，也可能
    // 是用户命令自行伪造的输出（命令实际已在沙箱内执行过一次）。
    if (isApplyDenied(res)) {
      // 权威判定：自有探针复测（绝不用用户命令输出判定嵌套）。
      if (nestedSandboxDetected === null) {
        nestedSandboxDetected = await this.probeNestedSandbox(opts.cwd);
      }
      if (nestedSandboxDetected) {
        // 探针同样被拒 → 真嵌套：apply 从未成功，子命令从未执行。
        // 记录进程级缓存后走 fail-closed fallback。
        return null;
      }
      // 探针成功 → apply 在本环境可用：用户命令确已在沙箱内执行过一次，
      // 其 71/空 stdout/stderr 是命令自身输出（投毒或巧合）。结果原样返回——
      // 不重跑命令（杜绝二次执行）、不降级缓存（杜绝后续 run 裸奔）。
    }

    // 从 stderr 抽真实存在的 EPERM-family 行作 epermHits；
    // 无关失败（stderr 无内核拒绝签名）原样透传，不伪造拒绝记录（缺陷 3）。
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
  }

  /**
   * 嵌套沙箱 fallback（fail-closed，见模块注释）。
   *
   * 本进程已在父 seatbelt 沙箱内，无法为子进程应用新 profile：
   * - 无规则需要强制（denyRead/denyWrite 全空且无网络约束）→ 在继承沙箱内
   *   直接执行（sandboxBypassed=true）；
   * - 有需强制的规则 → 拒绝执行（exit 126），surfacing 各条 unenforceable
   *   规则（含解析后路径）作 epermHits，统一带 [nested-unenforceable] 前缀
   *   与真实内核拒绝签名区分（round 2 缺陷 3）。stdout 恒为空——
   *   被拒绝执行的命令不可能泄漏 canary。
   */
  private async runVerifyNested(
    cmd: string,
    opts: RunVerifyOptions,
  ): Promise<VerifyResult> {
    const deniedRead = opts.fsRules.denyRead.map((p) => [p, resolveAbs(p)] as const);
    const deniedWrite = opts.fsRules.denyWrite.map((p) => [p, resolveAbs(p)] as const);
    // 网络约束判定：sealed 路径无条件 (deny network*)，故 allowedDomains 非空
    // （allowlist 语义 = 除白名单外全拒）或 denyOutCidr 非空都意味着需要强制
    // 网络隔离（round 2 缺陷 2）。两者皆空 = 调用方未要求任何网络约束。
    const netDenied =
      opts.netRules.allowedDomains.length > 0 ||
      opts.netRules.denyOutCidr.length > 0;

    if (deniedRead.length === 0 && deniedWrite.length === 0 && !netDenied) {
      // 无强制需求：命令在继承的父沙箱内执行，诚实标注 bypass。
      const res = await runShell(["sh", "-c", cmd], {
        cwd: opts.cwd,
        timeout_ms: opts.timeout_ms,
      });
      const epermHits = res.stderr
        .split("\n")
        .filter((line) => EPERM_RE.test(line));
      return {
        exitCode: res.exitCode,
        stdout: res.stdout,
        stderr: res.stderr,
        epermHits,
        sandboxBypassed: true,
      };
    }

    // fail-closed：需要强制的隔离无法建立 → 拒绝执行（exit 126）。
    // 合成串统一带 [nested-unenforceable] 前缀，与真实内核拒绝区分（缺陷 3）。
    const lines: string[] = [
      "[nested-unenforceable] sandbox-exec: sandbox_apply: Operation not permitted " +
        "(process already inside a seatbelt sandbox; nested profile apply is denied by the kernel)",
    ];
    for (const [orig, abs] of deniedRead) {
      lines.push(
        `[nested-unenforceable] sandbox: cannot enforce denyRead on ${orig} (realpath ${abs}): ` +
          `refusing to run command outside sandbox (Operation not permitted)`,
      );
    }
    for (const [orig, abs] of deniedWrite) {
      lines.push(
        `[nested-unenforceable] sandbox: cannot enforce denyWrite on ${orig} (realpath ${abs}): ` +
          `refusing to run command outside sandbox (Operation not permitted)`,
      );
    }
    if (netDenied) {
      const netDetail =
        `allowedDomains: [${opts.netRules.allowedDomains.join(", ")}], ` +
        `denyOutCidr: [${opts.netRules.denyOutCidr.join(", ")}]`;
      lines.push(
        `[nested-unenforceable] sandbox: cannot enforce network isolation (${netDetail}): ` +
          `refusing to run command outside sandbox (Operation not permitted)`,
      );
    }
    const stderr = lines.join("\n") + "\n";
    return {
      exitCode: 126,
      stdout: "",
      stderr,
      epermHits: lines,
    };
  }
}
