import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detect,
  type FsRules,
  type NetRules,
} from "@harness/l0-sandbox";

/**
 * L0S-T02 · OS sandbox 原语适配器
 *
 * 本文件覆盖两条 Given/When/Then：
 *   1. 正常路径：Given macOS + sandbox-exec 可用（或 Linux + bwrap）；
 *      When  runVerify('echo hi', {fsRules, netRules:{allowedDomains:[],denyOutCidr:[]}})；
 *      Then  exitCode=0, stdout 含 'hi'，sandbox 子进程执行后无残留（残留进程门由 L0S-T06 负责）。
 *   2. 错误路径：Given denyRead `~/.ssh`；When sandbox 内执行 `cat ~/.ssh/id_rsa`；
 *      Then  exitCode≠0，stderr 含 `Operation not permitted` / `EPERM`，
 *      epermHits 含 `open(~/.ssh/id_rsa)`。
 *
 * spec 执行提示：`~` 在 sandbox 内不展开，必须 brain 端 resolve。故测试把 HOME
 * 指向临时目录并构造 `~/.ssh/id_rsa` canary 文件，denyRead 用 brain 端解析后的
 * 绝对路径 `${home}/.ssh`，命令也用绝对路径，规避 shell `~` 展开的歧义。
 *
 * 真实 sandbox 行为门须 platform-gated：detect() 返回 'none' 时 skip（不 fail），
 * 与附录 A.4 platform-gate 语义一致。
 */

describe("L0S-T02", () => {
  const backend = detect();
  const noBackend = backend.platform === "none";

  let fakeHome: string;
  let originalHome: string | undefined;
  const canarySecret = "T02-SSH-CANARY-DO-NOT-LEAK-12345";

  beforeEach(() => {
    originalHome = process.env.HOME;
    fakeHome = mkdtempSync(join(tmpdir(), "l0s-t02-ssh-"));
    mkdirSync(join(fakeHome, ".ssh"), { recursive: true });
    // 真实私钥形态的 canary 内容；若 sandbox deny 未生效，stdout 会命中 canary。
    writeFileSync(
      join(fakeHome, ".ssh", "id_rsa"),
      `-----BEGIN OPENSSH PRIVATE KEY-----\n${canarySecret}\n-----END OPENSSH PRIVATE KEY-----\n`,
    );
    process.env.HOME = fakeHome;
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    rmSync(fakeHome, { recursive: true, force: true });
  });

  test.skipIf(noBackend)(
    "正常路径: runVerify('echo hi') exits 0 and captures stdout",
    async () => {
      const fsRules: FsRules = {
        allowWrite: [],
        denyWrite: [],
        denyRead: [],
        allowRead: [],
      };
      const netRules: NetRules = { allowedDomains: [], denyOutCidr: [] };

      const result = await backend.runVerify("echo hi", {
        cwd: fakeHome,
        timeout_ms: 10_000,
        fsRules,
        netRules,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("hi");
    },
  );

  test.skipIf(noBackend)(
    "sandbox denies reading ~/.ssh",
    async () => {
      const sshPath = join(fakeHome, ".ssh");
      const idRsaPath = join(sshPath, "id_rsa");
      const fsRules: FsRules = {
        allowWrite: [],
        denyWrite: [],
        denyRead: [sshPath],
        allowRead: [],
      };
      const netRules: NetRules = { allowedDomains: [], denyOutCidr: [] };

      const result = await backend.runVerify(`cat ${idRsaPath}`, {
        cwd: fakeHome,
        timeout_ms: 10_000,
        fsRules,
        netRules,
      });

      // 错误路径：exitCode 非 0。
      expect(result.exitCode).not.toBe(0);
      // stderr 须含内核强制拒绝语义（EPERM / Operation not permitted / Permission denied）。
      expect(result.stderr).toMatch(
        /Operation not permitted|EPERM|Permission denied/i,
      );
      // epermHits 须含对 id_rsa 路径的 open 拒绝记录。
      expect(Array.isArray(result.epermHits)).toBe(true);
      expect(result.epermHits.length).toBeGreaterThan(0);
      expect(
        result.epermHits.some(
          (hit) => hit.includes("id_rsa") || hit.includes(sshPath),
        ),
      ).toBe(true);
      // deny 生效 ⇒ canary 私钥内容绝不出现在 stdout（防 exfil）。
      expect(result.stdout).not.toContain(canarySecret);
    },
  );
});
