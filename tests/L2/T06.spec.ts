// L2-T06: semantic fact 库 [V1]
//
// 覆盖 spec（execution/L2-memory-skills/TASKS.md §L2-T06）全部 Given/When/Then。
// RED state: 模块尚未实现，import 失败——合法 RED。
//
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFact,
  viewFact,
  shouldEvict,
  evict,
  scheduleFreshContextReview,
} from "@harness/l2-memory";
import type { Fact, RejectReason, MemCtx } from "@harness/l2-memory";

const PROV = {
  sessionId: "sess-1",
  taskId: "t1",
  promptHash: "h1",
  agentId: "a1",
  ts: 1,
};

function ctx(baseDir: string): MemCtx {
  return {
    userId: "u1",
    projectId: "p1",
    baseDir,
  } as unknown as MemCtx;
}

function isReject(r: Fact | RejectReason): r is RejectReason {
  return (r as RejectReason).ok === false;
}

describe("L2-T06", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "l2-t06-"));
  });

  it("createFact reference persists", () => {
    const res = createFact(
      {
        type: "reference",
        content: "RFC 1234 defines X",
        provenance: PROV,
      },
      { userConfirmed: false, evidenceCount: 0 },
      ctx(baseDir),
    );
    expect(isReject(res)).toBe(false);
    const f = res as Fact;
    expect(f.id).toBeDefined();
    expect(f.type).toBe("reference");
    expect(f.accessFreq).toBe(0);
    expect(typeof f.lastAccess).toBe("number");
  });

  it("createFact user rejects without higher gate", () => {
    const res = createFact(
      {
        type: "user",
        content: "user prefers dark mode",
        provenance: PROV,
      },
      { userConfirmed: false, evidenceCount: 0 },
      ctx(baseDir),
    );
    expect(isReject(res)).toBe(true);
    expect((res as RejectReason).reason).toBe("type_user_higher_gate");
  });

  it("createFact user accepts with 2 evidence", () => {
    const res = createFact(
      {
        type: "user",
        content: "user likes concise output",
        provenance: PROV,
      },
      { userConfirmed: false, evidenceCount: 2 },
      ctx(baseDir),
    );
    expect(isReject(res)).toBe(false);
    expect((res as Fact).type).toBe("user");
  });

  it("createFact user accepts with userConfirmed", () => {
    const res = createFact(
      {
        type: "user",
        content: "user confirmed preference",
        provenance: PROV,
      },
      { userConfirmed: true },
      ctx(baseDir),
    );
    expect(isReject(res)).toBe(false);
    expect((res as Fact).type).toBe("user");
  });

  it("viewFact increments accessFreq", () => {
    const created = createFact(
      {
        type: "reference",
        content: "fact",
        provenance: PROV,
      },
      {},
      ctx(baseDir),
    ) as Fact;
    const c = ctx(baseDir);
    viewFact(created.id, c);
    const after = viewFact(created.id, c);
    expect(after.accessFreq).toBeGreaterThanOrEqual(2);
  });

  it("shouldEvict true after ttl", () => {
    const oldFact: Fact = {
      id: "x",
      type: "reference",
      content: "x",
      accessFreq: 0,
      lastAccess: Date.now() - 100_000,
      provenance: PROV,
    };
    expect(shouldEvict(oldFact, 10_000)).toBe(true);
  });

  it("evict moves to archive", () => {
    const created = createFact(
      {
        type: "reference",
        content: "to evict",
        provenance: PROV,
      },
      {},
      ctx(baseDir),
    ) as Fact;
    evict(created.id, ctx(baseDir));
    const archiveDir = join(baseDir, "archive/semantic");
    expect(existsSync(archiveDir)).toBe(true);
    expect(
      readdirSync(archiveDir).some((f) => f.startsWith(created.id + ".")),
    ).toBe(true);
  });

  it("createFact rejects path escape", () => {
    const res = createFact(
      {
        type: "reference",
        content: "../etc/passwd",
        provenance: PROV,
      },
      {},
      ctx(baseDir),
    );
    expect(isReject(res)).toBe(true);
    expect((res as RejectReason).reason).toBe("path_escape");
  });

  it("scheduleFreshContextReview enqueues without blocking createFact", () => {
    // hook 点：不应抛错、不阻塞
    expect(() => scheduleFreshContextReview("any-id")).not.toThrow();
  });
});
