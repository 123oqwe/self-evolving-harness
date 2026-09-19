// L2-T02: memory tool 六命令集成 + MEMORY.md 索引 + /memories 虚拟前缀 [MVP]
//
// 覆盖 spec（execution/L2-memory-skills/TASKS.md §L2-T02）全部 Given/When/Then。
// RED state: 模块尚未实现，从 `@harness/l2-memory` 的 import 会失败——合法 RED。
// 实现 GREEN 后，下列断言须真正检验行为。
//
// 测试隔离：通过 ctx.baseDir 指定 data 根（spec 的 MemCtx 未列 baseDir 字段，
// 此为测试隔离必需的扩展——见 ambiguities）。
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeMemory } from "@harness/l2-memory";
import type { MemResult } from "@harness/l2-memory";

const CTX = (baseDir: string) => ({
  userId: "u1",
  projectId: "p1",
  baseDir,
});

function isError(r: MemResult): boolean {
  return r.isError === true;
}

describe("L2-T02", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "l2-t02-"));
  });

  it("view returns file content", () => {
    // 先 create 一个文件再 view
    const created = executeMemory(
      { command: "create", path: "/memories/foo", content: "hello foo" },
      CTX(baseDir),
    );
    expect(isError(created)).toBe(false);
    const res = executeMemory(
      { command: "view", path: "/memories/foo" },
      CTX(baseDir),
    );
    expect(isError(res)).toBe(false);
    expect((res as MemResult).content).toContain("hello foo");
  });

  it("create creates file and appends index", () => {
    const res = executeMemory(
      { command: "create", path: "/memories/foo", content: "body" },
      CTX(baseDir),
    );
    expect(isError(res)).toBe(false);
    // 物理文件存在
    const physPath = join(
      baseDir,
      "data/active/memory/u1/p1/foo.md",
    );
    expect(existsSync(physPath)).toBe(true);
    expect(readFileSync(physPath, "utf8")).toBe("body");
    // MEMORY.md 索引追加一行
    const indexPath = join(baseDir, "data/active/memory/u1/p1/MEMORY.md");
    expect(existsSync(indexPath)).toBe(true);
    const index = readFileSync(indexPath, "utf8");
    expect(index.length).toBeGreaterThan(0);
    expect(index).toContain("foo");
  });

  it("create refuses overwrite", () => {
    const first = executeMemory(
      { command: "create", path: "/memories/foo", content: "first" },
      CTX(baseDir),
    );
    expect(isError(first)).toBe(false);
    const second = executeMemory(
      { command: "create", path: "/memories/foo", content: "second" },
      CTX(baseDir),
    );
    expect(isError(second)).toBe(true);
    expect((second as MemResult).content.toLowerCase()).toContain("overwrite");
    // 文件内容未被覆写
    const physPath = join(
      baseDir,
      "data/active/memory/u1/p1/foo.md",
    );
    expect(readFileSync(physPath, "utf8")).toBe("first");
  });

  it("str_replace rejects non-unique old_str", () => {
    executeMemory(
      { command: "create", path: "/memories/foo", content: "aa aa" },
      CTX(baseDir),
    );
    const res = executeMemory(
      {
        command: "str_replace",
        path: "/memories/foo",
        old_str: "a",
        new_str: "b",
      },
      CTX(baseDir),
    );
    expect(isError(res)).toBe(true);
    expect((res as MemResult).content.toLowerCase()).toContain("not unique");
  });

  it("str_replace replaces unique match", () => {
    executeMemory(
      { command: "create", path: "/memories/foo", content: "hello world" },
      CTX(baseDir),
    );
    const res = executeMemory(
      {
        command: "str_replace",
        path: "/memories/foo",
        old_str: "world",
        new_str: "there",
      },
      CTX(baseDir),
    );
    expect(isError(res)).toBe(false);
    const physPath = join(
      baseDir,
      "data/active/memory/u1/p1/foo.md",
    );
    expect(readFileSync(physPath, "utf8")).toBe("hello there");
  });

  it("create rejects path escape ../", () => {
    const res = executeMemory(
      {
        command: "create",
        path: "/memories/../etc/passwd",
        content: "x",
      },
      CTX(baseDir),
    );
    expect(isError(res)).toBe(true);
    expect((res as MemResult).content.toLowerCase()).toContain("escape");
  });

  it("create rejects path escape %2e%2e", () => {
    const res = executeMemory(
      {
        command: "create",
        path: "/memories/%2e%2e/evil",
        content: "x",
      },
      CTX(baseDir),
    );
    expect(isError(res)).toBe(true);
    expect((res as MemResult).content.toLowerCase()).toContain("escape");
  });

  it("view rejects operating on /memories root", () => {
    const res = executeMemory(
      { command: "view", path: "/memories" },
      CTX(baseDir),
    );
    expect(isError(res)).toBe(true);
  });

  it("MEMORY.md cap 200 lines drops tail", () => {
    const ctx = CTX(baseDir);
    // 写 200 条使其满
    for (let i = 0; i < 200; i++) {
      executeMemory(
        {
          command: "create",
          path: `/memories/n${i}`,
          content: `line ${i}`,
        },
        ctx,
      );
    }
    const indexPath = join(
      baseDir,
      "data/active/memory/u1/p1/MEMORY.md",
    );
    let lines = readFileSync(indexPath, "utf8").split("\n");
    lines = lines.filter((l) => l.length > 0);
    expect(lines.length).toBeLessThanOrEqual(200);
    // 第 201 次：仍保持 ≤200 行（tail 丢弃，不报错）
    executeMemory(
      { command: "create", path: "/memories/overflow", content: "x" },
      ctx,
    );
    let after = readFileSync(indexPath, "utf8").split("\n");
    after = after.filter((l) => l.length > 0);
    expect(after.length).toBeLessThanOrEqual(200);
  });

  it("MEMORY.md cap 25KB drops tail", () => {
    const ctx = CTX(baseDir);
    const big = "x".repeat(300); // 每行 ~300 bytes，快速逼近 25KB
    for (let i = 0; i < 200; i++) {
      executeMemory(
        { command: "create", path: `/memories/big${i}`, content: big },
        ctx,
      );
    }
    const indexPath = join(
      baseDir,
      "data/active/memory/u1/p1/MEMORY.md",
    );
    const stat = readFileSync(indexPath, "utf8");
    expect(Buffer.byteLength(stat, "utf8")).toBeLessThanOrEqual(25600);
  });

  it("delete moves to archive not physical delete", () => {
    executeMemory(
      { command: "create", path: "/memories/foo", content: "keep" },
      CTX(baseDir),
    );
    const res = executeMemory(
      { command: "delete", path: "/memories/foo" },
      CTX(baseDir),
    );
    expect(isError(res)).toBe(false);
    // active 物理文件不存在
    const physPath = join(
      baseDir,
      "data/active/memory/u1/p1/foo.md",
    );
    expect(existsSync(physPath)).toBe(false);
    // archive 含 foo.<ts>.md
    const archiveDir = join(
      baseDir,
      "archive/memory/u1/p1",
    );
    expect(existsSync(archiveDir)).toBe(true);
    const archived = readdirSync(archiveDir).filter((f) =>
      f.startsWith("foo."),
    );
    expect(archived.length).toBeGreaterThanOrEqual(1);
  });
});
