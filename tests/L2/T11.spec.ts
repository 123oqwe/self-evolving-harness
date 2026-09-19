// L2-T11: commit-on-success terminal-verdict 门 + 版本后缀回滚 + staging 门 [V1]
//
// 覆盖 spec（execution/L2-memory-skills/TASKS.md §L2-T11）全部 Given/When/Then。
// RED state: 模块尚未实现，import 失败——合法 RED。
//
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  commitOnSuccess,
  rollback,
  getLatestVersion,
  getIndexVersions,
} from "@harness/l2-memory";
import type { CommittedSkill, SkillVariant, RejectReason, MemCtx } from "@harness/l2-memory";

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

const PROV = {
  sessionId: "sess-1",
  taskId: "t1",
  promptHash: "h1",
  agentId: "a1",
  ts: 1,
};

function variant(name: string, version = 1): SkillVariant {
  return {
    id: `${name}-id`,
    name,
    version,
    body: `body ${name} v${version}`,
    status: "staging",
    provenance: PROV,
  };
}

function isReject(r: CommittedSkill | RejectReason): r is RejectReason {
  return (r as RejectReason).ok === false;
}

describe("L2-T11", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "l2-t11-"));
  });

  it("commitOnSuccess accepts on exitCode=0", () => {
    const res = commitOnSuccess(
      variant("pdf"),
      { exitCode: 0, stdout: "", stderr: "" },
      ctx(baseDir),
    );
    expect(isReject(res)).toBe(false);
    const s = res as CommittedSkill;
    expect(s.name).toMatch(/pdfV\d+/);
  });

  it("commitOnSuccess rejects on exitCode=1", () => {
    const res = commitOnSuccess(
      variant("pdf"),
      { exitCode: 1, stdout: "", stderr: "fail" },
      ctx(baseDir),
    );
    expect(isReject(res)).toBe(true);
  });

  it("commitOnSuccess rejects without verdict", () => {
    // verdict 缺失（prose claim only）→ reject
    const res = commitOnSuccess(
      variant("pdf"),
      undefined as unknown as { exitCode: number; stdout: string; stderr: string },
      ctx(baseDir),
    );
    expect(isReject(res)).toBe(true);
  });

  it("commit appends version suffix nameV2", () => {
    const c = ctx(baseDir);
    const v1 = commitOnSuccess(
      variant("pdf"),
      { exitCode: 0, stdout: "", stderr: "" },
      c,
    ) as CommittedSkill;
    expect(v1.name).toBe("pdfV1");
    const v2 = commitOnSuccess(
      variant("pdf"),
      { exitCode: 0, stdout: "", stderr: "" },
      c,
    ) as CommittedSkill;
    expect(v2.name).toBe("pdfV2");
  });

  it("index holds only latest version", () => {
    const c = ctx(baseDir);
    commitOnSuccess(
      variant("pdf"),
      { exitCode: 0, stdout: "", stderr: "" },
      c,
    );
    commitOnSuccess(
      variant("pdf"),
      { exitCode: 0, stdout: "", stderr: "" },
      c,
    );
    commitOnSuccess(
      variant("pdf"),
      { exitCode: 0, stdout: "", stderr: "" },
      c,
    );
    // index 持唯一最新版：getLatestVersion 返回 3，且仅一条（旧版被删）
    expect(getLatestVersion("pdf", c)).toBe(3);
    expect(getIndexVersions("pdf", c)).toEqual([3]);
  });

  it("rollback restores previous version", () => {
    const c = ctx(baseDir);
    commitOnSuccess(
      variant("pdf"),
      { exitCode: 0, stdout: "", stderr: "" },
      c,
    );
    commitOnSuccess(
      variant("pdf"),
      { exitCode: 0, stdout: "", stderr: "" },
      c,
    );
    const restored = rollback("pdf", 1, c);
    expect(restored.version).toBe(1);
    expect(getLatestVersion("pdf", c)).toBe(1);
  });

  it("rollback rebuilds index", () => {
    const c = ctx(baseDir);
    commitOnSuccess(
      variant("pdf"),
      { exitCode: 0, stdout: "", stderr: "" },
      c,
    );
    commitOnSuccess(
      variant("pdf"),
      { exitCode: 0, stdout: "", stderr: "" },
      c,
    );
    rollback("pdf", 1, c);
    // rollback 后 index 持 v1 唯一最新版
    expect(getLatestVersion("pdf", c)).toBe(1);
    expect(getIndexVersions("pdf", c)).toEqual([1]);
  });
});
