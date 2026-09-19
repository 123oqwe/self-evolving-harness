import { describe, test, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detect, type FsRules, type NetRules } from "@harness/l0-sandbox";

/**
 * L0S-T02 · 边界（无后端 => skip + warn）
 *
 * Given 平台无 seatbelt 也无 bwrap（如 CI 容器）；
 * When  detect()；
 * Then  platform='none' + emit warn event，runVerify 仍执行
 *       （fallback 到无沙箱执行，但记录 sandbox_bypassed=true 供 CE 标记）。
 *
 * 本测试直接实例化 NoneBackend 策略类（与 detect() 在无后端环境下的返回等价），
 * 以检验真实 fallback 执行路径，而非用空 mock 自测。NoneBackend 须由包导出
 * （strategy pattern，对应 spec REFACTOR「backend 选择用 strategy pattern」）。
 *
 * 注：spec 行为规范要求「emit warn event」，但 VerifyResult/OssandboxBackend
 * 接口未定义 warn 的 surfacing 通道（事件 emitter？console.warn？OTel？）。
 * 本测试断言可观测的确定性证据：platform='none' + 命令正常执行 + sandbox_bypassed=true。
 * warn event 的具体 surfacing 机制见返回的 ambiguities。
 */

describe("L0S-T02", () => {
  // 强制无后端：detect() 始终返回 NoneBackend，模拟「无 seatbelt 也无 bwrap」。
  vi.mock("@harness/l0-sandbox", async (importOriginal) => {
    const actual =
      await importOriginal<typeof import("@harness/l0-sandbox")>();
    return {
      ...actual,
      detect: () => new actual.NoneBackend(),
    };
  });

  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "l0s-t02-skip-"));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  test("no backend => skip+warn", async () => {
    const backend = detect();

    // 边界：platform 必须为 'none'。
    expect(backend.platform).toBe("none");

    const fsRules: FsRules = {
      allowWrite: [],
      denyWrite: [],
      denyRead: [],
      allowRead: [],
    };
    const netRules: NetRules = { allowedDomains: [], denyOutCidr: [] };

    // runVerify 仍执行（fallback 到无沙箱执行）。
    const result = await backend.runVerify("echo hi", {
      cwd: workspace,
      timeout_ms: 5_000,
      fsRules,
      netRules,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hi");
    // 记录 sandbox_bypassed=true 供 CE 标记（spec 行为规范明确）。
    expect(result.sandboxBypassed).toBe(true);
  });
});
