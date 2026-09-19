import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveFsRules,
  isDenied,
  type FsRules,
  type ResolvedFsRules,
} from "@harness/l0-sandbox";

/**
 * L0S-T03 · 错误路径（symlink bypass）
 * Given denyRead ~/.ssh
 * When  sandbox 内 `cat $(readlink ~/ssh-symlink)`
 *       其中 ~/ssh-symlink → ~/.ssh（symlink 指向被禁路径）
 * Then  normalize resolve symlink 后 denied=true（防 symlink 绕过）
 *
 * spec 执行提示：用 `fs.realpath` 解析 symlink 后必须再 normalize，
 * 否则攻击者用 symlink 前缀绕过 prefix match。
 */
describe("L0S-T03", () => {
  let fakeHome: string;
  let workspaceCwd: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    fakeHome = mkdtempSync(join(tmpdir(), "l0s-t03-sym-home-"));
    workspaceCwd = mkdtempSync(join(tmpdir(), "l0s-t03-sym-ws-"));
    process.env.HOME = fakeHome;
    // 真实创建 ~/.ssh 目录 + 一个指向它的 symlink ~/ssh-symlink
    mkdirSync(join(fakeHome, ".ssh"), { recursive: true });
    symlinkSync(join(fakeHome, ".ssh"), join(fakeHome, "ssh-symlink"), "dir");
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(workspaceCwd, { recursive: true, force: true });
  });

  test("symlink to denied path is resolved and blocked", () => {
    const rules: FsRules = {
      allowWrite: [workspaceCwd],
      denyWrite: [],
      denyRead: ["~/.ssh"],
      allowRead: [workspaceCwd],
    };

    const resolved: ResolvedFsRules = resolveFsRules(rules, workspaceCwd);

    // 攻击者用 symlink 路径访问被禁的 ~/.ssh/id_rsa
    const bypassPath = "~/ssh-symlink/id_rsa";
    const result = isDenied(bypassPath, resolved, "read");

    expect(result.denied).toBe(true);
    expect(result.reason).toMatch(/denyRead/);
  });

  test("absolute symlink to denied absolute path is resolved and blocked", () => {
    const sshAbs = join(fakeHome, ".ssh");
    const linkAbs = join(fakeHome, "ssh-link-abs");
    symlinkSync(sshAbs, linkAbs, "dir");

    const rules: FsRules = {
      allowWrite: [workspaceCwd],
      denyWrite: [],
      denyRead: [sshAbs],
      allowRead: [workspaceCwd],
    };

    const resolved = resolveFsRules(rules, workspaceCwd);

    const result = isDenied(join(linkAbs, "id_rsa"), resolved, "read");

    expect(result.denied).toBe(true);
    expect(result.reason).toMatch(/denyRead/);
  });

  test("symlink to allowed workspace path is not blocked", () => {
    // 正向：指向 allowRead 路径的 symlink 不应被误判 deny
    const linkToWs = join(fakeHome, "ws-link");
    symlinkSync(workspaceCwd, linkToWs, "dir");

    const rules: FsRules = {
      allowWrite: [workspaceCwd],
      denyWrite: [],
      denyRead: ["~/.ssh"],
      allowRead: [workspaceCwd],
    };

    const resolved = resolveFsRules(rules, workspaceCwd);

    const result = isDenied(join(linkToWs, "taskfile.md"), resolved, "read");

    expect(result.denied).toBe(false);
  });
});
