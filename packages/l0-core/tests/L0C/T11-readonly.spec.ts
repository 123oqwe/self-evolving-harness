// L0C-T11 — static-core 运行时只读强制
// 测试根：packages/l0-core/tests/L0C/T11-readonly.spec.ts
// 导入路径：@harness/l0-core（spec 声明的包名）
//
// 本文件为 RED 阶段产物：模块尚未实现，import 会失败——合法 RED。
// 断言逻辑在实现完成后能真正检验行为。
//
// 路径约定（见 spec G/W/T 示例）：STATIC_CORE_DIRS 与本测试使用的路径均以
// 仓库根为基准的相对路径（如 "packages/l0-core/src/transcript/turn.ts"）。
// 实现 isStaticCorePath/assertWritable 须以 path.resolve 解析（基准 = process.cwd()，
// 即仓库根，与 verify.sh A.3 派发 `pnpm vitest run packages/l0-core/tests/L0C/...`
// 自仓库根执行一致）。

import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import {
  STATIC_CORE_DIRS,
  isStaticCorePath,
  assertWritable,
  enforceReadOnly,
} from "@harness/l0-core";

// ───────────────────────────────────────────────────────────────────────────
// helpers
// ───────────────────────────────────────────────────────────────────────────

/** 断言给定调用抛出 code==='EPERM' 的错误；返回捕获到的 error 供进一步断言。 */
function expectEPERM(fn: () => unknown): { code: string; message: string } {
  let caught: unknown = undefined;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(Error);
  const err = caught as Error & { code?: string };
  expect(err.code).toBe("EPERM");
  return { code: err.code ?? "", message: err.message };
}

// ───────────────────────────────────────────────────────────────────────────

describe("L0C-T11", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // STATIC_CORE_DIRS 契约
  // ─────────────────────────────────────────────────────────────────────────

  describe("STATIC_CORE_DIRS", () => {
    it("registers the three protected static-core subtrees", () => {
      // spec 接口签名声明的三个受保护目录，顺序与字面量须对齐
      expect(Array.isArray(STATIC_CORE_DIRS)).toBe(true);
      expect([...STATIC_CORE_DIRS]).toEqual([
        "packages/l0-core",
        "packages/canary-eval/src/verifier",
        "packages/canary-eval/canary",
      ]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // isStaticCorePath
  // ─────────────────────────────────────────────────────────────────────────

  describe("isStaticCorePath", () => {
    it("returns true for a file inside packages/l0-core", () => {
      expect(isStaticCorePath("packages/l0-core/src/transcript/turn.ts")).toBe(
        true
      );
    });

    it("returns true for the l0-core package root itself", () => {
      // 子树边界：根目录本身也属 static-core
      expect(isStaticCorePath("packages/l0-core")).toBe(true);
    });

    it("returns true for a file inside the canary verifier subtree", () => {
      expect(
        isStaticCorePath("packages/canary-eval/src/verifier/run.ts")
      ).toBe(true);
    });

    it("returns true for a file inside the canary content subtree", () => {
      expect(isStaticCorePath("packages/canary-eval/canary/task-001.md")).toBe(
        true
      );
    });

    it("returns false for an L1 evolvable substrate path", () => {
      expect(isStaticCorePath("packages/l1-config/prompts/foo.md")).toBe(false);
    });

    it("returns false for a prefix-collision sibling (l0-core-evil)", () => {
      // 前缀碰撞攻击：l0-core-evil 字符串前缀含 l0-core 但非其子树
      expect(isStaticCorePath("packages/l0-core-evil/x")).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // assertWritable — spec G/W/T 四场景
  // ─────────────────────────────────────────────────────────────────────────

  describe("assertWritable", () => {
    // Given agent 进程尝试 fs.writeFile('packages/l0-core/src/transcript/turn.ts', ...)
    // When  assertWritable 拦截
    // Then  throw EPERM（错误路径：static-core 不可写）
    it("EPERM on static-core write", () => {
      const { code } = expectEPERM(() =>
        assertWritable("packages/l0-core/src/transcript/turn.ts")
      );
      expect(code).toBe("EPERM");
    });

    it("EPERM on canary verifier write", () => {
      const { code } = expectEPERM(() =>
        assertWritable("packages/canary-eval/src/verifier/run.ts")
      );
      expect(code).toBe("EPERM");
    });

    it("EPERM on canary content write", () => {
      const { code } = expectEPERM(() =>
        assertWritable("packages/canary-eval/canary/task-001.md")
      );
      expect(code).toBe("EPERM");
    });

    // Given agent 写 packages/l1-config/prompts/foo.md（L1 可进化基质）
    // When  assertWritable
    // Then  通过（正常：L1 可写）
    it("allows L1 write", () => {
      expect(() =>
        assertWritable("packages/l1-config/prompts/foo.md")
      ).not.toThrow();
    });

    // Given 路径 packages/l0-core/../l1-config/x.md（symlink/traversal 尝试绕过）
    // When  assertWritable（先 path.resolve）
    // Then  解析后指向 L1 → 通过（边界：resolve 防绕过）
    it("resolves traversal", () => {
      // 含 .. 的路径经 resolve 后落入 L1 子树，不属 static-core → 放行
      expect(() =>
        assertWritable("packages/l0-core/../l1-config/x.md")
      ).not.toThrow();
      // 旁证：同样的 traversal 解析后等价于 L1 路径
      const resolved = path.resolve("packages/l0-core/../l1-config/x.md");
      expect(resolved.replace(/\\/g, "/")).toContain("l1-config/x.md");
    });

    it("traversal into static-core still blocked after resolve", () => {
      // 反向验证：.. 解析后仍指向 static-core 子树 → 仍 EPERM
      expectEPERM(() =>
        assertWritable("packages/l1-config/../l0-core/src/index.ts")
      );
    });

    // Given 路径 packages/l0-core-evil/x（前缀碰撞攻击）
    // When  assertWritable（用 path.sep 边界匹配）
    // Then  通过（边界：非 l0-core 子树）
    it("rejects prefix-collision attack", () => {
      // 攻击被 reject = 路径被正确识别为非 static-core 子树 → 放行写
      expect(() => assertWritable("packages/l0-core-evil/x")).not.toThrow();
      // 旁证：isStaticCorePath 须用 path.sep 边界匹配，不能被字符串前缀欺骗
      expect(isStaticCorePath("packages/l0-core-evil/x")).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // enforceReadOnly — wrap agent process writePath
  // ─────────────────────────────────────────────────────────────────────────
  // 语义假设（spec 未明确）：enforceReadOnly 包裹 agentProcess.writePath，
  // 使其后续调用经 assertWritable 拦截——写 static-core → reject EPERM，
  // 写其他路径 → 透传原 writePath。已记入 ambiguities。

  describe("enforceReadOnly", () => {
    it("blocks wrapped writePath targeting a static-core path with EPERM", async () => {
      const writePath = vi.fn().mockResolvedValue(undefined);
      const agentProcess = { writePath };

      await enforceReadOnly(agentProcess);

      // 包裹后写 static-core → reject（原 writePath 不应被调用）
      await expect(
        agentProcess.writePath("packages/l0-core/src/transcript/turn.ts")
      ).rejects.toMatchObject({ code: "EPERM" });
      expect(writePath).not.toHaveBeenCalled();
    });

    it("passes through wrapped writePath for an L1 path", async () => {
      const writePath = vi.fn().mockResolvedValue(undefined);
      const agentProcess = { writePath };

      await enforceReadOnly(agentProcess);

      await agentProcess.writePath("packages/l1-config/prompts/foo.md");
      expect(writePath).toHaveBeenCalledTimes(1);
      expect(writePath).toHaveBeenCalledWith(
        "packages/l1-config/prompts/foo.md"
      );
    });
  });
});
