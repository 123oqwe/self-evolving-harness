// L0C-T06: 3-level progressive disclosure 契约 + memory tool 六命令 schema
//
// RED state: 模块尚未实现，从 `@harness/l0-core` 的 import 会失败 —— 这是合法 RED。
// 实现 GREEN 后，下列断言须真正检验行为。
//
import { describe, it, expect } from "vitest";
import {
  // progressive disclosure
  assertLevel1Only,
  PROGRESSIVE_LEVELS,
  // memory tool 六命令
  validateMemoryCommand,
  assertCanonicalPath,
  assertStrReplaceUnique,
  assertCreateNoOverwrite,
  // type-only exports are imported via `import type` below
} from "@harness/l0-core";
import type {
  SkillMetadataL1,
  MemoryCommand,
} from "@harness/l0-core";

// ---------------------------------------------------------------------------
// 辅助：构造合法的六命令 input
// ---------------------------------------------------------------------------
const VALID_VIEW = { command: "view", path: "/memories/foo" } as const;
const VALID_CREATE = {
  command: "create",
  path: "/memories/notes.md",
  content: "# notes",
} as const;
const VALID_STR_REPLACE = {
  command: "str_replace",
  path: "/memories/notes.md",
  old_str: "a",
  new_str: "b",
} as const;
const VALID_INSERT = {
  command: "insert",
  path: "/memories/notes.md",
  insert_line: 3,
  content: "inserted",
} as const;
const VALID_DELETE = {
  command: "delete",
  path: "/memories/notes.md",
} as const;
const VALID_RENAME = {
  command: "rename",
  path: "/memories/old.md",
  new_path: "/memories/new.md",
} as const;

describe("L0C-T06", () => {
  // =========================================================================
  // 3-level progressive disclosure 契约
  // =========================================================================
  describe("progressive disclosure", () => {
    it("PROGRESSIVE_LEVELS exposes the 3 ordered levels L1->L2->L3", () => {
      expect(PROGRESSIVE_LEVELS).toEqual([
        "L1-metadata",
        "L2-skill-md",
        "L3-references",
      ]);
    });

    it("L1 metadata only allows name+description (assertLevel1Only passes)", () => {
      const meta: SkillMetadataL1 = {
        name: "my-skill",
        description: "does a thing",
      };
      expect(() => assertLevel1Only(meta)).not.toThrow();
    });

    it("L1 metadata containing extra `body` field is rejected (防 Level 2 内容泄漏进 Level 1 常驻区)", () => {
      // 故意多带一个 body 字段，模拟 Level 2 内容泄漏进 Level 1 常驻区
      const meta = {
        name: "my-skill",
        description: "does a thing",
        body: "FULL SKILL BODY THAT SHOULD NOT BE IN L1",
      } as unknown as SkillMetadataL1;
      expect(() => assertLevel1Only(meta)).toThrow();
    });

    it("L1 metadata containing any other extra field is rejected", () => {
      const meta = {
        name: "my-skill",
        description: "does a thing",
        scripts: ["run.sh"],
      } as unknown as SkillMetadataL1;
      expect(() => assertLevel1Only(meta)).toThrow();
    });
  });

  // =========================================================================
  // memory tool 六命令 schema
  // =========================================================================
  describe("validateMemoryCommand — six commands", () => {
    it("validates six commands (view/create/str_replace/insert/delete/rename each one valid case)", () => {
      const cases = [
        VALID_VIEW,
        VALID_CREATE,
        VALID_STR_REPLACE,
        VALID_INSERT,
        VALID_DELETE,
        VALID_RENAME,
      ];
      const expected: MemoryCommand[] = [
        "view",
        "create",
        "str_replace",
        "insert",
        "delete",
        "rename",
      ];
      for (let i = 0; i < cases.length; i++) {
        const res = validateMemoryCommand(cases[i]);
        expect(res.ok).toBe(true);
        if (res.ok) {
          expect(res.command).toBe(expected[i]);
        }
      }
    });

    it("valid `view /memories/foo` input returns {ok:true, command:'view'}", () => {
      const res = validateMemoryCommand(VALID_VIEW);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.command).toBe("view");
      }
    });

    it("view with optional path omitted is still valid (path is Optional)", () => {
      const res = validateMemoryCommand({ command: "view" });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.command).toBe("view");
      }
    });

    it("rejects extra fields via strict schema (view command with stray `content`)", () => {
      // view 命令多带了 content 字段 → typebox strict 形状锁 → {ok:false}
      const res = validateMemoryCommand({
        command: "view",
        path: "/memories/foo",
        content: "should not be here",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(typeof res.error).toBe("string");
        expect(res.error.length).toBeGreaterThan(0);
      }
    });

    it("rejects unknown command", () => {
      const res = validateMemoryCommand({
        command: "explode",
        path: "/memories/foo",
      });
      expect(res.ok).toBe(false);
    });

    it("rejects create missing required `content`", () => {
      const res = validateMemoryCommand({
        command: "create",
        path: "/memories/notes.md",
      });
      expect(res.ok).toBe(false);
    });

    it("rejects str_replace missing required `old_str`/`new_str`", () => {
      const res = validateMemoryCommand({
        command: "str_replace",
        path: "/memories/notes.md",
        old_str: "a",
        // new_str missing
      });
      expect(res.ok).toBe(false);
    });

    it("rejects insert missing required `insert_line`/`content`", () => {
      const res = validateMemoryCommand({
        command: "insert",
        path: "/memories/notes.md",
        insert_line: 3,
        // content missing
      });
      expect(res.ok).toBe(false);
    });

    it("rejects rename missing required `new_path`", () => {
      const res = validateMemoryCommand({
        command: "rename",
        path: "/memories/old.md",
      });
      expect(res.ok).toBe(false);
    });

    it("rejects non-object input", () => {
      expect(validateMemoryCommand(null).ok).toBe(false);
      expect(validateMemoryCommand(undefined).ok).toBe(false);
      expect(validateMemoryCommand("view").ok).toBe(false);
      expect(validateMemoryCommand(42).ok).toBe(false);
      expect(validateMemoryCommand([]).ok).toBe(false);
    });
  });

  // =========================================================================
  // str_replace 唯一性
  // =========================================================================
  describe("assertStrReplaceUnique", () => {
    it("passes when old_str appears exactly once in content", () => {
      const content = "line one\nMARKER\nline three";
      expect(() => assertStrReplaceUnique(content, "MARKER")).not.toThrow();
    });

    it("str_replace rejects non-unique old_str (appears 2 times) — 不静默改错处", () => {
      const content = "MARKER and MARKER again";
      expect(() => assertStrReplaceUnique(content, "MARKER")).toThrow();
    });

    it("rejects when old_str does not occur at all (nothing to replace)", () => {
      const content = "nothing to see here";
      expect(() => assertStrReplaceUnique(content, "NOPE")).toThrow();
    });
  });

  // =========================================================================
  // create 拒覆写
  // =========================================================================
  describe("assertCreateNoOverwrite", () => {
    it("passes when target does not exist (exists=false)", () => {
      expect(() => assertCreateNoOverwrite(false)).not.toThrow();
    });

    it("create rejects overwrite (exists=true) — 拒覆写", () => {
      expect(() => assertCreateNoOverwrite(true)).toThrow();
    });
  });

  // =========================================================================
  // canonical path 校验
  // =========================================================================
  describe("assertCanonicalPath", () => {
    it("passes for a legal nested memory path", () => {
      expect(() => assertCanonicalPath("/memories/foo/bar/notes.md")).not.toThrow();
    });

    it("passes for a single-segment memory path", () => {
      expect(() => assertCanonicalPath("/memories/foo")).not.toThrow();
    });

    it("canonical path rejects traversal `../` (越界)", () => {
      expect(() =>
        assertCanonicalPath("/memories/../../etc/passwd"),
      ).toThrow();
    });

    it("canonical path rejects URL-encoded traversal `%2e%2e`", () => {
      expect(() =>
        assertCanonicalPath("/memories/%2e%2e/%2e%2e/etc/passwd"),
      ).toThrow();
    });

    it("canonical path rejects operating on the `/memories` root itself", () => {
      // 操作 /memories 根（无 trailing 子路径）→ throw
      expect(() => assertCanonicalPath("/memories")).toThrow();
      expect(() => assertCanonicalPath("/memories/")).toThrow();
    });

    it("canonical path rejects path entirely outside the memory root", () => {
      expect(() => assertCanonicalPath("/etc/passwd")).toThrow();
      expect(() => assertCanonicalPath("../etc/passwd")).toThrow();
    });
  });
});
