import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveFsRules,
  isDenied,
  type FsRules,
  type ResolvedFsRules,
} from "@harness/l0-sandbox";

/**
 * L0S-T03 · 正常路径
 * Given denyRead ['~/.ssh', '~/.aws'] + allowRead workspace cwd
 * When  isDenied('~/.ssh/id_rsa', rules, 'read')
 * Then  denied=true, reason='denyRead: ~/.ssh'
 *
 * spec 明确：`~` 在 sandbox 内不展开，必须 brain 端 resolve。
 * 故 resolveFsRules 负责把 `~` 展开为绝对路径，isDenied 对展开后的
 * 前缀做匹配。
 */
describe("L0S-T03", () => {
  let fakeHome: string;
  let workspaceCwd: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    fakeHome = mkdtempSync(join(tmpdir(), "l0s-t03-ssh-"));
    workspaceCwd = mkdtempSync(join(tmpdir(), "l0s-t03-ws-"));
    process.env.HOME = fakeHome;
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

  test("denyRead ~/.ssh blocks read", () => {
    const rules: FsRules = {
      allowWrite: [workspaceCwd],
      denyWrite: [],
      denyRead: ["~/.ssh", "~/.aws"],
      allowRead: [workspaceCwd],
    };

    const resolved: ResolvedFsRules = resolveFsRules(rules, workspaceCwd);

    const result = isDenied("~/.ssh/id_rsa", resolved, "read");

    expect(result.denied).toBe(true);
    expect(typeof result.reason).toBe("string");
    expect(result.reason).toMatch(/denyRead/);
    // reason 必须能定位到触发拒绝的规则前缀（展开后的 ~/.ssh）
    expect(result.reason).toContain(".ssh");
  });

  test("denyRead ~/.aws blocks read of aws creds", () => {
    const rules: FsRules = {
      allowWrite: [workspaceCwd],
      denyWrite: [],
      denyRead: ["~/.ssh", "~/.aws"],
      allowRead: [workspaceCwd],
    };

    const resolved = resolveFsRules(rules, workspaceCwd);

    const result = isDenied("~/.aws/credentials", resolved, "read");

    expect(result.denied).toBe(true);
    expect(result.reason).toMatch(/denyRead/);
    expect(result.reason).toContain(".aws");
  });

  test("allowRead workspace cwd permits read inside workspace", () => {
    const rules: FsRules = {
      allowWrite: [workspaceCwd],
      denyWrite: [],
      denyRead: ["~/.ssh", "~/.aws"],
      allowRead: [workspaceCwd],
    };

    const resolved = resolveFsRules(rules, workspaceCwd);

    const result = isDenied(join(workspaceCwd, "taskfile.md"), resolved, "read");

    expect(result.denied).toBe(false);
  });

  test("denyRead blocks write-attempt on ssh path too (write implies read)", () => {
    const rules: FsRules = {
      allowWrite: [workspaceCwd],
      denyWrite: [],
      denyRead: ["~/.ssh"],
      allowRead: [workspaceCwd],
    };

    const resolved = resolveFsRules(rules, workspaceCwd);

    const result = isDenied("~/.ssh/id_rsa", resolved, "write");

    expect(result.denied).toBe(true);
  });
});
