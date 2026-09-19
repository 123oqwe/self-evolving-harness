// L2-T03a: auto-memory 在线 Reflexion 写 loop [V1]
//
// 覆盖 spec（execution/L2-memory-skills/TASKS.md §L2-T03a）全部 Given/When/Then。
// RED state: 模块尚未实现，从 `@harness/l2-memory` 的 import 会失败——合法 RED。
// 实现 GREEN 后，下列断言须真正检验行为。
//
// 测试隔离：通过 ctx.baseDir 指定 data 根 + transcript 根。
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeReflexion } from "@harness/l2-memory";
import type { ReflexionNote, MemCtx } from "@harness/l2-memory";

// 模拟 telemetry transcript writer（异模块契约 @harness/telemetry）
vi.mock("@harness/telemetry", () => ({
  createTranscriptWriter: vi.fn(() => ({
    startSession: vi.fn(async () => "sess-1"),
    append: vi.fn(async () => "node-1"),
    appendSubagentBoundary: vi.fn(),
    loadSession: vi.fn(async () => []),
    verifyTree: vi.fn(() => ({ ok: true, orphans: [] })),
    sessionPath: vi.fn(() => "/tmp/x.jsonl"),
  })),
}));

function ctx(baseDir: string): MemCtx {
  return {
    userId: "u1",
    projectId: "p1",
    baseDir,
    sessionId: "sess-1",
    taskId: "t1",
    promptHash: "h1",
    agentId: "a1",
  } as unknown as MemCtx;
}

describe("L2-T03a", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "l2-t03a-"));
  });

  it("writeReflexion persists note and provenance", () => {
    const note = writeReflexion(
      {
        sessionId: "sess-1",
        taskId: "t1",
        content: "tried approach X, worked",
        promptHash: "h1",
        agentId: "a1",
        outcome: "success",
      },
      ctx(baseDir),
    );
    expect(note.id).toBeDefined();
    expect(typeof note.id).toBe("string");
    expect(note.id.length).toBeGreaterThan(0);
    expect(note.ts).toBeGreaterThan(0);
    // 笔记落 reflexion/
    const dir = join(
      baseDir,
      "data/active/memory/u1/p1/reflexion",
    );
    expect(existsSync(dir)).toBe(true);
    const files = readdirSync(dir);
    expect(files.length).toBeGreaterThanOrEqual(1);
    const content = readFileSync(join(dir, files[0]), "utf8");
    expect(content).toContain("tried approach X, worked");
  });

  it("rejects content with credential path", () => {
    const fn = () =>
      writeReflexion(
        {
          sessionId: "sess-1",
          taskId: "t1",
          content: "the key is at /Users/bob/secret.key",
          promptHash: "h1",
          agentId: "a1",
          outcome: "failure",
        },
        ctx(baseDir),
      );
    expect(fn).toThrow(/credential|path|secret|redact/i);
  });

  it("duplicate write creates new id not overwrite", () => {
    const c = ctx(baseDir);
    const n1 = writeReflexion(
      {
        sessionId: "sess-1",
        taskId: "t1",
        content: "first note",
        promptHash: "h1",
        agentId: "a1",
        outcome: "success",
      },
      c,
    );
    const n2 = writeReflexion(
      {
        sessionId: "sess-1",
        taskId: "t1",
        content: "second note",
        promptHash: "h1",
        agentId: "a1",
        outcome: "success",
      },
      c,
    );
    expect(n1.id).not.toBe(n2.id);
    // 两个文件均存在（不覆盖）
    const dir = join(
      baseDir,
      "data/active/memory/u1/p1/reflexion",
    );
    expect(readdirSync(dir).length).toBeGreaterThanOrEqual(2);
  });
});
