// CLN-T03 · Linux CI 非 root 跑 L0S 测试 + bwrap --cap-drop ALL [Wave 2]
//
// Spec: execution/cleanup/TASKS.md §CLN-T03
// SUT: packages/l0-sandbox 的 bwrap 后端 + .github/workflows/ CI 配置
//
// 任务背景（ERRATA-w01 §L0S-R1）：Linux CI 以 root uid 运行时 bwrap
// mode-000 遮蔽失效（root 绕过文件权限），L0S-T02 sandbox 隔离契约在 root
// 下不可信。两条缓解（纵深防御）：(a) CI 以非 root uid 跑 L0S 测试；
// (b) bwrap 启动加 `--cap-drop ALL`，且该参数不可被 config 关闭
// （static-core 收紧方向，breaker clause 拒绝放宽）。
//
// RED 形态（当前）：
//  - bwrap 后端 buildArgs 输出 *不含* `--cap-drop ALL` → 断言失败；
//  - `BWRAP_HARDENED_ARGS` / `StaticCoreTamperError` / `buildBwrapArgs` 未导出
//    → undefined → 断言失败；
//  - `.github/workflows/` 不存在 → CI 非 root 断言失败。
//
// 断言逻辑在实现完成后能真正检验行为：测 argv 含 --cap-drop ALL + breaker
// reject 放宽尝试 + CI workflow grep 非 root user 步骤，不测实现细节。
//
// 注：macOS 路径走 platform-gate skip，本测试不触发真实 bwrap 执行（只构造
// argv），故在 macOS 上也可运行。

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BubblewrapBackend } from "@harness/l0-sandbox";
import type { FsRules, NetRules } from "@harness/l0-sandbox";

// 迁移前未导出的绑定通过动态 import（`any`）取回——避免 @ts-expect-error
// 在迁移后变成 unused directive 的隐患。迁移前 = undefined（RED）。
const Sandbox: any = await import("@harness/l0-sandbox");
const BWRAP_HARDENED_ARGS = Sandbox.BWRAP_HARDENED_ARGS;
const StaticCoreTamperError = Sandbox.StaticCoreTamperError;
const buildBwrapArgs = Sandbox.buildBwrapArgs;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");

const EMPTY_FS: FsRules = {
  allowWrite: [],
  denyWrite: [],
  denyRead: [],
  allowRead: [],
};
const EMPTY_NET: NetRules = {
  allowedDomains: [],
  denyOutCidr: [],
};

// ---------------------------------------------------------------------------
// CLN-T03 · bwrap --cap-drop ALL 硬编码 + breaker 守卫
// ---------------------------------------------------------------------------

describe("CLN-T03 · bwrap 后端 --cap-drop ALL 硬编码（static-core 收紧）", () => {
  it("Given bwrap 后端启动，When 构造 argv，Then 含 `--cap-drop ALL`（不可缺省）", () => {
    // G/W/T2：argv 固定前置 `--cap-drop ALL`，与现有 --unshare-* 叠加。
    const backend = new BubblewrapBackend();
    const argv = backend.buildArgs(
      "true",
      EMPTY_FS,
      EMPTY_NET,
      "/tmp/work",
      [],
    );
    expect(argv).toContain("--cap-drop ALL");
    // bwrap 前缀仍在（未被替换）。
    expect(argv[0]).toBe("bwrap");
  });

  it("Given 迁移完成，When 取 BWRAP_HARDENED_ARGS 导出，Then 它是 frozen 且含 `--cap-drop ALL`", () => {
    // G/W/T2 + REFACTOR：硬编码常量抽出，冻结防篡改。
    expect(BWRAP_HARDENED_ARGS).toBeDefined();
    expect(Array.isArray(BWRAP_HARDENED_ARGS)).toBe(true);
    expect(Object.isFrozen(BWRAP_HARDENED_ARGS)).toBe(true);
    expect([...(BWRAP_HARDENED_ARGS as readonly string[])]).toContain(
      "--cap-drop ALL",
    );
  });

  it("Given 默认 config（不放宽），When buildBwrapArgs()，Then argv 含 `--cap-drop ALL`", () => {
    // G/W/T2：默认路径产出含 cap-drop 的完整 argv。
    expect(buildBwrapArgs).toBeDefined();
    const argv = (
      buildBwrapArgs as (config?: unknown) => string[]
    )();
    expect(argv).toContain("--cap-drop ALL");
  });

  it("Given config 试图移除 `--cap-drop ALL`（恶意/误改），When buildBwrapArgs({removeHardened:[...]}), Then throw StaticCoreTamperError", () => {
    // G/W/T3：breaker clause reject 任何移除 `--cap-drop ALL` 的尝试
    // （WBS §3.1 L0C-T10 同源 StaticCoreTamperError）。
    expect(StaticCoreTamperError).toBeDefined();
    const ErrCtor = StaticCoreTamperError as unknown as new (
      msg?: string,
    ) => Error;
    // 是 Error 子类。
    expect(new ErrCtor("tamper")).toBeInstanceOf(Error);
    expect(new ErrCtor("tamper").name).toBe("StaticCoreTamperError");

    const build = buildBwrapArgs as (config?: {
      removeHardened?: readonly string[];
    }) => string[];

    // 试图移除 cap-drop → throw。
    expect(() =>
      build({ removeHardened: ["--cap-drop ALL"] }),
    ).toThrow(ErrCtor);

    // 空移除列表 → 不抛，仍含 cap-drop（守卫只拦放宽，不拦默认）。
    expect(() => build({ removeHardened: [] })).not.toThrow();
    expect(build({ removeHardened: [] })).toContain("--cap-drop ALL");
  });
});

// ---------------------------------------------------------------------------
// CLN-T03 · CI workflow 非 root user
// ---------------------------------------------------------------------------

describe("CLN-T03 · Linux CI 非 root user 跑 L0S 测试", () => {
  const workflowsDir = resolve(REPO_ROOT, ".github/workflows");

  function readAllWorkflows(): { name: string; text: string }[] {
    if (!existsSync(workflowsDir)) return [];
    return readdirSync(workflowsDir)
      .filter((f) => /\.(ya?ml)$/i.test(f))
      .map((name) => ({
        name,
        text: readFileSync(join(workflowsDir, name), "utf8"),
      }));
  }

  it("Given Linux CI workflow，When 检查 .github/workflows/，Then 存在至少一个 workflow 文件", () => {
    // G/W/T1 前置：CI 配置必须存在。
    const files = readAllWorkflows();
    expect(files.length).toBeGreaterThan(0);
  });

  it("Given L0S 测试 job，When grep workflow，Then 以非 root user 执行（useradd + chown + su/runuser）", () => {
    // G/W/T1：CI 以非 root uid 执行（id -u ≠ 0）；bwrap mode-000 遮蔽在非
    // root 下生效。spec 明确配方：useradd + chown workspace + su <user> 跑
    // tests/L0S/...。三段独立断言，任一缺失即 RED。
    // 注：不得用 `GITHUB_WORKSPACE` 作为非 root 执行证据——几乎任何 workflow
    // （含以 root 跑的）都会引用该变量，会构成蒙混通道（不可蒙混）。
    const files = readAllWorkflows();
    expect(files.length).toBeGreaterThan(0);
    const blob = files.map((f) => f.text).join("\n");
    // (a) 创建非 root user 的证据。
    const createsNonRoot = /\b(useradd|adduser)\b/.test(blob);
    // (b) 把 workspace 所有权转交给该 user 的证据（spec: chown workspace）。
    const chownsWorkspace = /\bchown\b/.test(blob);
    // (c) 以该 user 身份执行测试的证据（su / runuser / 容器 --user / sudo -u）。
    const runsAsNonRoot =
      /\bsu\b|\brunuser\b|--user\b|\bsudo\s+-u\b/.test(blob);
    expect(createsNonRoot).toBe(true);
    expect(chownsWorkspace).toBe(true);
    expect(runsAsNonRoot).toBe(true);
    // 实际跑了 L0S 测试。
    expect(blob).toMatch(/tests\/L0S/);
  });
});
