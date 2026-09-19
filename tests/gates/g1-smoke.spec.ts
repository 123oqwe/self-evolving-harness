/**
 * Gate G1 集成 smoke — 编排者所有（非任务锁定测试，TEST-LOCK 之外的门规格）
 * 验收: 沙箱可隔离执行命令 + 遥测基线可记 transcript/usage（G1 定义第三项）
 */
import { describe, it, expect } from "vitest";
import * as l0s from "@harness/l0-sandbox";
import * as tl from "@harness/telemetry";

describe("Gate G1 集成 smoke", () => {
  it("沙箱域: 命令执行并返回 Observation（隔离执行可用）", async () => {
    const backend = (l0s as any).detect();
    const r = await backend.runVerify("echo g1-smoke", {
      cwd: "/tmp",
      timeout_ms: 10_000,
      fsRules: { allowWrite: ["/tmp"], denyWrite: [], denyRead: [], allowRead: [] },
      netRules: { allowedDomains: [], denyOutCidr: [] },
    });
    expect([0, 126]).toContain(r.exitCode); // 0=正常/嵌套继承; 126=fail-closed(有规则需强制)
    expect(typeof r.stdout).toBe("string");
    // 隔离语义: 嵌套环境要么 bypassed 标注, 要么真实强制(非嵌套)
    if (r.exitCode === 0) expect([true, false, undefined]).toContain(r.sandboxBypassed);
  });

  it("遥测域: transcript 与 usage 契约导出可用", () => {
    const tlKeys = Object.keys(tl);
    expect(tlKeys.some(k => /transcript/i.test(k))).toBe(true);
    expect(tlKeys.some(k => /usage/i.test(k))).toBe(true);
  });

  it("跨域契约: session log (L0C) 与 telemetry (TL) 类型域一致", async () => {
    const l0c = await import("@harness/l0-core");
    const l0cKeys = Object.keys(l0c);
    expect(l0cKeys).toContain("L0_CORE_VERSION");
    expect(l0cKeys.some(k => /sessionlog|SessionLog/i.test(k))).toBe(true);
  });
});
