import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileRegistry } from "@harness/l0-sandbox";

/**
 * L0S-T07 · 边界（自指 denyRead）
 *
 * Spec G/W/T:
 *   Given profile 路径 packages/l0-sandbox/profiles/；
 *   When  sandbox 内 `cat profiles/v1.yaml`；
 *   Then  denied（自指 denyRead），agent 不可见 profile 内容。
 *
 * loader 在加载 profile 时须把 profile 目录自身注入 denyRead（防 agent 读 profile 推测策略）。
 */
describe("L0S-T07", () => {
  let profilesDir: string;

  beforeEach(() => {
    profilesDir = join(tmpdir(), "l0s-t07-selfdeny-" + process.pid);
    mkdirSync(profilesDir, { recursive: true });
    writeFileSync(
      join(profilesDir, "v1.yaml"),
      "version: v1\nfs:\n  denyRead:\n    - ~/.ssh\nsyscalls:\n  deny:\n    - ptrace\n",
    );
    writeFileSync(
      join(profilesDir, "v1.sha256"),
      "0000000000000000000000000000000000000000000000000000000000000000",
    );
  });

  afterEach(() => {
    rmSync(profilesDir, { recursive: true, force: true });
  });

  test("profile dir self-denied", async () => {
    const reg = new ProfileRegistry({ profilesDir });

    const loaded = await reg.load("v1");

    // profile 目录自身必须出现在 denyRead（自指 denyRead 不变量）。
    const denyReadJoined = loaded.fs.denyRead.join("\n");
    expect(denyReadJoined).toContain(profilesDir);
  });
});
