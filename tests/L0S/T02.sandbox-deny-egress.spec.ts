import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detect,
  type FsRules,
  type NetRules,
} from "@harness/l0-sandbox";

/**
 * L0S-T02 · 逃逸门（验收硬约束）
 *
 * Given denyRead `~/.ssh` + denyOut `0.0.0.0/0` + allowedDomains=[]；
 * When  sandbox 内执行 `curl -s evil.com`；
 * Then  连接拒绝（exit≠0 / stderr 含 `Could not resolve` / `Connection refused` /
 *        `Network is unreachable` / `Operation not permitted`）。
 *
 * 设计要点：T02 阶段 bwrap `--unshare-net` / seatbelt `(deny network-out)` 作
 * deny-default 全断网，allowlist 的 socat proxy 在 T04a 实现。故 allowedDomains=[]
 * 时任何出站均被拒。`--max-time` 兜底防挂死。
 *
 * 真实 sandbox 行为门须 platform-gated：detect() 返回 'none' 时 skip（不 fail）。
 */

describe("L0S-T02", () => {
  const backend = detect();
  const noBackend = backend.platform === "none";

  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "l0s-t02-egress-"));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  test.skipIf(noBackend)(
    "sandbox denies non-allowlist egress",
    async () => {
      const fsRules: FsRules = {
        allowWrite: [],
        denyWrite: [],
        denyRead: [],
        allowRead: [],
      };
      // 全断网：allowlist 空 + denyOut 全 CIDR。
      const netRules: NetRules = {
        allowedDomains: [],
        denyOutCidr: ["0.0.0.0/0"],
      };

      const result = await backend.runVerify(
        "curl -s --max-time 5 https://evil.com",
        {
          cwd: workspace,
          timeout_ms: 15_000,
          fsRules,
          netRules,
        },
      );

      // 逃逸门：出站必须被拒绝。
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(
        /Could not resolve|Connection refused|Could not connect|Network is unreachable|Operation not permitted/i,
      );
    },
  );
});
