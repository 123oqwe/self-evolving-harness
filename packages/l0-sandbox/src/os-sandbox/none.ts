/**
 * L0S-T02 — 无后端 fallback 策略
 *
 * 裁决 L0S-T02-A3：NoneBackend 须由包导出，供直接实例化 / vi.mock 检验真实 fallback。
 * 平台无 seatbelt 也无 bwrap 时（detect()==none），runVerify 仍执行（无沙箱），
 * 但返回 `sandboxBypassed=true` 供 CE 标记（spec 行为规范：fallback + 记 bypass）。
 */

import { runShell } from "./spawn.js";
import type {
  OssandboxBackend,
  RunVerifyOptions,
  VerifyResult,
} from "./types.js";

export class NoneBackend implements OssandboxBackend {
  readonly platform = "none" as const;

  async runVerify(cmd: string, opts: RunVerifyOptions): Promise<VerifyResult> {
    const res = await runShell(["sh", "-c", cmd], {
      cwd: opts.cwd,
      timeout_ms: opts.timeout_ms,
    });
    return {
      exitCode: res.exitCode,
      stdout: res.stdout,
      stderr: res.stderr,
      epermHits: [],
      sandboxBypassed: true,
    };
  }
}
