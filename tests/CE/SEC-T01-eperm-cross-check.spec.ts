// SEC-T01: L0S-R2 强制交叉验证 — epermHits × exitCode 伪造面丢弃
//
// 覆盖 spec（execution/adapt/TASKS.md §SEC-T01）的 Given/When/Then 全部场景：
//   1. crossCheckEperm: epermHits=[] → consistent（dropped=false）
//   2. crossCheckEperm: epermHits 非空 + exitCode!==0 → consistent
//   3. crossCheckEperm: epermHits 非空 + exitCode===0 → forged-suspect（dropped=true）
//   4. filterForgedEperm: 丢弃 forged-suspect + 发 warnings
//   5. assertFreshEvidence: 伪造 eperm 证据被丢弃后才判定（接线单一入口）
//
// 依据：ERRATA-w01 §L0S-R2 裁决——用户可控 stderr 伪造 EPERM 行仍可进 epermHits，
// CE 消费 epermHits 时须交叉验证 exitCode。
//
// RED state: @harness/canary-eval 未导出 crossCheckEperm/filterForgedEperm
// → import 失败 = 合法 RED。
//
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  crossCheckEperm,
  filterForgedEperm,
  assertFreshEvidence,
  AbortSelectError,
} from "@harness/canary-eval";
import type { VerifierRun, FreshEvidence } from "@harness/canary-eval";

function mkRun(opts: {
  taskId?: string;
  exitCode: number;
  epermHits?: string[];
}): VerifierRun {
  return {
    taskId: opts.taskId ?? "CE-TASK-0001",
    command: "pytest -x tests/",
    exitCode: opts.exitCode,
    stdout: "",
    stderr: "",
    runId: `run-${Math.random().toString(36).slice(2, 8)}`,
    contiguousRun: true,
    epermHits: opts.epermHits,
  };
}

describe("SEC-T01 · crossCheckEperm", () => {
  it("consistent when epermHits empty", () => {
    // Given exitCode=0, epermHits=[]
    const r = crossCheckEperm({ exitCode: 0, epermHits: [] });
    // Then consistent, not dropped
    expect(r.verdict).toBe("consistent");
    expect(r.dropped).toBe(false);
  });

  it("consistent when epermHits non-empty and exitCode non-zero", () => {
    // Given exitCode=1, epermHits=['packages/l0-core/x']
    const r = crossCheckEperm({
      exitCode: 1,
      epermHits: ["packages/l0-core/x"],
    });
    // Then consistent（EPERM 导致非零 exit，自洽）
    expect(r.verdict).toBe("consistent");
    expect(r.dropped).toBe(false);
  });

  it("forged-suspect when epermHits non-empty but exitCode=0", () => {
    // Given exitCode=0, epermHits=['packages/l0-core/x']（成功 exit 但报 EPERM = 伪造面）
    const r = crossCheckEperm({
      exitCode: 0,
      epermHits: ["packages/l0-core/x"],
    });
    // Then forged-suspect + dropped=true + reason 含 exitCode=0 但 epermHits 非空
    expect(r.verdict).toBe("forged-suspect");
    expect(r.dropped).toBe(true);
    expect(r.reason).toContain("exitCode");
    expect(r.reason).toContain("0");
  });
});

describe("SEC-T01 · filterForgedEperm", () => {
  it("drops forged-suspect runs and emits warnings", () => {
    // Given 一组 VerifierRun：1 条 forged-suspect + 2 条 consistent
    const runs: VerifierRun[] = [
      mkRun({ taskId: "T-forged", exitCode: 0, epermHits: ["path/x"] }),
      mkRun({ taskId: "T-ok-1", exitCode: 0, epermHits: [] }),
      mkRun({ taskId: "T-ok-2", exitCode: 1, epermHits: ["path/y"] }),
    ];
    // When filterForgedEperm
    const { kept, dropped, warnings } = filterForgedEperm(runs);
    // Then kept.length===2, dropped.length===1, warnings.length===1
    expect(kept.length).toBe(2);
    expect(dropped.length).toBe(1);
    expect(warnings.length).toBe(1);
    // And 被丢的是 forged-suspect（taskId=T-forged）
    expect(dropped[0]!.taskId).toBe("T-forged");
    // And warning 含被丢证据 taskId 便于审计
    expect(warnings[0]).toContain("T-forged");
  });

  it("all-consistent runs → kept unchanged, dropped empty", () => {
    const runs: VerifierRun[] = [
      mkRun({ exitCode: 0, epermHits: [] }),
      mkRun({ exitCode: 1, epermHits: ["x"] }),
    ];
    const { kept, dropped, warnings } = filterForgedEperm(runs);
    expect(kept.length).toBe(2);
    expect(dropped.length).toBe(0);
    expect(warnings.length).toBe(0);
  });
});

describe("SEC-T01 · assertFreshEvidence 接线", () => {
  it("drops forged eperm evidence before judging", () => {
    // Given 一条 forged-suspect VerifierRun（exitCode=0 + epermHits 非空）
    // 若不交叉验证，它会作为 exitCode=0 pass 证据被 fresh-evidence 门接受。
    const forged = mkRun({
      taskId: "T-forged",
      exitCode: 0,
      epermHits: ["path/x"],
    });
    const evidence: FreshEvidence = {
      variantSha: "sha-variant",
      verifications: [forged],
      hasExitCodeEvidence: true,
    };
    // When/Then assertFreshEvidence 须丢弃伪造面证据 → verifications 变空 → abort
    // （伪造 eperm 证据不能背书 select；丢弃后无机械证据 = abort）
    expect(() => assertFreshEvidence(evidence)).toThrow(AbortSelectError);
  });

  it("filterForgedEperm is wired into assertFreshEvidence entry (single responsibility)", () => {
    // Given SEC-T01 落地后，assertFreshEvidence 入口须先调 filterForgedEperm
    // 过滤伪造面证据再判定。RED 态：fresh-evidence-gate.ts 未接线 filterForgedEperm
    // → grep 源码不含 filterForgedEperm → 本断言失败（合法 RED）。
    // 实现后：源码含 filterForgedEperm 调用，断言通过。
    const src = readFileSync(
      join(__dirname, "..", "..", "packages", "canary-eval", "src", "fresh-evidence-gate.ts"),
      "utf8",
    );
    expect(src).toContain("filterForgedEperm");
  });
});
