// T01 · 变异 LLM 隔离（P0，安全）
//
// 评测 SEC-01/CLM-02：`RealLLMPort` 与 `PiHeadlessLLM` 直接 spawn `pi -p`，
// 不带 `--no-tools` / `--no-session`，且用仓库根作 cwd、继承完整 process.env。
// pi 默认启用 read/write/edit/bash 且无权限弹窗 → 一条注入到失败轨迹里的文本
// 就能让变异环节在本机执行 shell（改 tests/、TEST-LOCK.md、偷环境变量）。
//
// 本测试锁定修复后的契约：
//   1. argv 必须含 `--no-tools` 与 `--no-session`；
//   2. 子进程 cwd 不是仓库根（隔离临时目录）；
//   3. 环境变量白名单生效——测试导出的 FAKE_SECRET_TOKEN 不得出现在子进程 env；
//   4. pi 非零退出时抛出的错误带 stderr 尾部（不再「失败了但不知道为什么」）。
//
// 用 `tests/fixtures/fake-pi/pi`（记录 argv/cwd/secret 到 FAKE_PI_LOG）驱动，
// 不依赖真实 pi，可在 CI 双平台跑。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { RealLLMPort } from "@harness/l3-engine";

const FAKE_PI = fileURLToPath(new URL("../fixtures/fake-pi/pi", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");

describe("T01 · mutation LLM isolation", () => {
  let dir: string;
  let wrapper: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "t01-isolation-"));
    chmodSync(FAKE_PI, 0o755);
    // 包装脚本：在被允许的环境里自行注入 FAKE_PI_LOG（env 白名单会剥掉测试
    // 直接导出的变量），再 exec 真 fixture。
    const log = join(dir, "calls.log");
    wrapper = join(dir, "pi-wrap.sh");
    writeFileSync(
      wrapper,
      `#!/bin/sh\nexport FAKE_PI_LOG="${log}"\nexec "${FAKE_PI}" "$@"\n`,
      "utf8",
    );
    chmodSync(wrapper, 0o755);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.FAKE_SECRET_TOKEN;
  });

  it("spawn 时带 --no-tools/--no-session、cwd 不在仓库根、env 不含假密钥", async () => {
    process.env.FAKE_SECRET_TOKEN = "{{sec:fake_secret_token}}";
    const port = new RealLLMPort({ piBin: wrapper, timeoutMs: 20_000 });

    const reply = await port.complete("hello");
    expect(reply).toBeTruthy();

    const logPath = join(dir, "calls.log");
    expect(existsSync(logPath)).toBe(true);
    const calls = readFileSync(logPath, "utf8");

    // 1. 去工具 + 不落 session
    expect(calls).toContain("--no-tools");
    expect(calls).toContain("--no-session");

    // 2. cwd 隔离（不是仓库根）
    const cwdLine = calls.split("\n").find((l) => l.startsWith("CWD: "));
    expect(cwdLine, "fake pi 应记录 CWD").toBeTruthy();
    const childCwd = (cwdLine as string).slice("CWD: ".length).trim();
    expect(childCwd).not.toBe(REPO_ROOT);
    expect(childCwd.startsWith(REPO_ROOT)).toBe(false);

    // 3. env 白名单：测试导出的假密钥不得进入子进程
    expect(calls).toContain("SECRET: <unset>");
  });

  it("pi 非零退出 → 错误带 stderr 尾部", async () => {
    const failWrapper = join(dir, "pi-fail.sh");
    writeFileSync(
      failWrapper,
      `#!/bin/sh\necho "boom-diagnosis-tail" >&2\nexit 3\n`,
      "utf8",
    );
    chmodSync(failWrapper, 0o755);

    const port = new RealLLMPort({
      piBin: failWrapper,
      timeoutMs: 20_000,
      maxRetries: 0,
    });

    await expect(port.complete("hello")).rejects.toMatchObject({
      stderr: expect.stringContaining("boom-diagnosis-tail"),
    });
  });
});

void dirname;
