import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ProfileRegistry } from "@harness/l0-sandbox";

/**
 * L0S-T07 · sha256 校验
 *
 * Spec G/W/T:
 *   Given profile 文件被篡改；
 *   When  load('v1')；
 *   Then  sha256 不匹配 throw。
 */
describe("L0S-T07", () => {
  let profilesDir: string;

  beforeEach(() => {
    profilesDir = join(tmpdir(), "l0s-t07-sha-" + process.pid);
    mkdirSync(profilesDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(profilesDir, { recursive: true, force: true });
  });

  function writeProfile(content: string, sha: string) {
    writeFileSync(join(profilesDir, "v1.yaml"), content);
    writeFileSync(join(profilesDir, "v1.sha256"), sha);
  }

  test("tampered profile rejected", async () => {
    const content =
      "version: v1\nfs:\n  denyRead:\n    - ~/.ssh\nsyscalls:\n  deny:\n    - ptrace\n";
    const goodSha = createHash("sha256").update(content).digest("hex");
    writeProfile(content, goodSha);

    const reg = new ProfileRegistry({ profilesDir });
    const loaded = await reg.load("v1");
    expect(loaded.sha256).toBe(goodSha);

    // 篡改 profile 内容但不更新 sha256 → load 须 throw。
    writeFileSync(
      join(profilesDir, "v1.yaml"),
      content + "# evil tamper line\n",
    );
    await expect(reg.load("v1")).rejects.toThrow();
  });
});
