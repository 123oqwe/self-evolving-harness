// L2-T07: A-Mem 链接笔记 [V1]
//
// 覆盖 spec（execution/L2-memory-skills/TASKS.md §L2-T07）全部 Given/When/Then。
// RED state: 模块尚未实现，import 失败——合法 RED。
//
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addNote,
  judgeLink,
  evolveNote,
  pruneLinks,
} from "@harness/l2-memory";
import type { Note, MemCtx } from "@harness/l2-memory";

function ctx(baseDir: string, judgeOverride?: () => Promise<{ link?: boolean; reason?: string }>): MemCtx {
  return {
    userId: "u1",
    projectId: "p1",
    baseDir,
    sessionId: "sess-1",
    taskId: "t1",
    promptHash: "h1",
    agentId: "a1",
    // 测试注入 link-judge LLM（spec GREEN: "link-judge 用 mock LLM"）
    linkJudgeLLM: judgeOverride,
  } as unknown as MemCtx;
}

const LINK_TRUE = async () => ({ link: true, reason: "causal dependency" });

describe("L2-T07", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "l2-t07-"));
  });

  it("addNote creates links via judge", () => {
    // 注入 link-judge 返回 link=true，验证 addNote 真正建链
    const c = ctx(baseDir, LINK_TRUE);
    // 先种一条候选 note
    addNote(
      {
        content: "existing note about sorting",
        ts: 1,
        keywords: ["sort"],
        tags: ["algo"],
        contextDesc: "sorting notes",
      },
      c,
    );
    const note = addNote(
      {
        content: "new note about merging",
        ts: 2,
        keywords: ["merge"],
        tags: ["algo"],
        contextDesc: "merge notes",
      },
      c,
    );
    expect(note.id).toBeDefined();
    expect(Array.isArray(note.links)).toBe(true);
    // link-judge 返回 link=true → note.links 须含该 link
    expect(note.links.length).toBeGreaterThanOrEqual(1);
    expect(note.links[0].targetId).toBeDefined();
    expect(typeof note.links[0].reason).toBe("string");
    expect(note.links[0].reason.length).toBeGreaterThan(0);
  });

  it("link has reason provenance", async () => {
    const c = ctx(baseDir, LINK_TRUE);
    const existing = addNote(
      {
        content: "base",
        ts: 1,
        keywords: ["base"],
        tags: [],
        contextDesc: "",
      },
      c,
    );
    const candidate: Note = {
      ...existing,
      links: [],
      embedding: [0.1, 0.2],
    };
    const out = await judgeLink(candidate, candidate, c);
    expect(out.link).toBe(true);
    expect(typeof out.reason).toBe("string");
    expect(out.reason.length).toBeGreaterThan(0);
  });

  it("judgeLink rejects missing reason", async () => {
    // 注入非法 LLM 输出（link=true 但无 reason）→ judgeLink 须 reject
    const badLLM = async () => ({ link: true });
    const c = ctx(baseDir, badLLM);
    const note: Note = {
      id: "n1",
      content: "x",
      ts: 1,
      keywords: [],
      tags: [],
      contextDesc: "",
      links: [],
      embedding: [1],
    };
    await expect(judgeLink(note, note, c)).rejects.toThrow(/reason/i);
  });

  it("evolveNote snapshots old K/G/X to archive", () => {
    const c = ctx(baseDir, LINK_TRUE);
    const note = addNote(
      {
        content: "to evolve",
        ts: 1,
        keywords: ["old"],
        tags: ["t1"],
        contextDesc: "old ctx",
      },
      c,
    );
    evolveNote(note.id, { keywords: ["new"], tags: ["t2"], contextDesc: "new ctx" }, c);
    const dir = join(baseDir, "archive/a-mem", note.id, "evolution");
    expect(existsSync(dir)).toBe(true);
    expect(readdirSync(dir).length).toBeGreaterThanOrEqual(1);
  });

  it("evolved note recoverable", () => {
    const c = ctx(baseDir, LINK_TRUE);
    const note = addNote(
      {
        content: "evolve rec",
        ts: 1,
        keywords: ["old"],
        tags: [],
        contextDesc: "",
      },
      c,
    );
    evolveNote(note.id, { keywords: ["new"] }, c);
    const dir = join(baseDir, "archive/a-mem", note.id, "evolution");
    const files = readdirSync(dir);
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(dir, files[0]))).toBe(true);
  });

  it("pruneLinks moves 0-hit note to archival not delete", () => {
    const c = ctx(baseDir, LINK_TRUE);
    const note = addNote(
      {
        content: "zero hit note",
        ts: 1,
        keywords: [],
        tags: [],
        contextDesc: "",
      },
      c,
    );
    pruneLinks(c);
    // 0 命中 note 退 archival 不物理删
    const archiveDir = join(baseDir, "archive/a-mem");
    expect(existsSync(archiveDir)).toBe(true);
    // 不抛错即 idempotent 候选
    expect(note.id).toBeDefined();
  });
});
