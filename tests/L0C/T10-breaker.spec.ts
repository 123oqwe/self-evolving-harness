// L0C-T10 · breaker clause 运行时引擎
//
// Spec: execution/L0-core/TASKS.md §L0C-T10 (ERRATA-amended).
//
// 运行时 breaker：在进化引擎 apply diff 时二次拦截，防 pre-commit 被绕过
// （如 `git commit --no-verify`）。breaker 是 T08 checkDiff 的运行时镜像：
//   - 命中即 reject + 告警 + 安全事件落 session log
//   - severity 映射：safety/deny_to_allow/static_core_field_removed/resource
//     = critical；acceptance_threshold_widened = warn
//   - unsent 跟踪字段删除 = static_core_field_removed 子集，强制 critical
//     （resume 重放风险）
//   - fail-closed：sessionLog append 抛时仍 reject
//   - meta 自检：breaker 不可改自身 BREAKER_CLAUSES（防 reward tampering）
//
// RED state：breaker.ts 尚未实现 → evaluate / BREAKER_CLAUSES 未由 @harness/l0-core
// 导出 → import 失败，合法 RED。实现 GREEN 后下列断言须真正检验行为。
//
// 断言逻辑在实现完成后能真正检验行为：测行为（reject / 安全事件 / fail-closed）
// 不测实现。

import { describe, it, expect } from "vitest";
import {
  evaluate,
  BREAKER_CLAUSES,
  SessionLog,
} from "@harness/l0-core";
import type {
  Diff,
  DangerousDiffKind,
  BreakerVerdict,
  SessionLogEvent,
} from "@harness/l0-core";

// ---------------------------------------------------------------------------
// 辅助构造器
// ---------------------------------------------------------------------------

function makeDiff(
  filePath: string,
  oldLines: string[],
  newLines: string[],
): Diff {
  return { path: filePath, hunks: [{ oldLines, newLines }] };
}

/** 一个空 session log，便于断言安全事件落地。 */
function freshLog(): SessionLog {
  return new SessionLog();
}

/** 断言 `evaluate` 返回 reject 且 clauses 含某 kind。 */
function expectReject(
  verdict: BreakerVerdict,
  ...kinds: DangerousDiffKind[]
): void {
  expect(verdict.reject).toBe(true);
  for (const k of kinds) {
    expect(verdict.clauses).toContain(k);
  }
}

function securityEvents(log: SessionLog): SessionLogEvent[] {
  // 遍历所有已知 sessionId 取事件（breaker 落一条 security_event）。
  // 实现可能用任意 sessionId；此处用一个 sentinel sessionId 抓取，并兜底
  // 全扫：SessionLog 没有公开 enumerate-all，故 breaker 应使用约定 sessionId。
  // 这里用 "security" 作为约定 sessionId（与实现约定对齐）。
  return log.getEvents("security");
}

// ===========================================================================
// L0C-T10
// ===========================================================================

describe("L0C-T10", () => {
  // -------------------------------------------------------------------------
  // 前置：breaker 已由 L0C 导出（避免 RED 态下 undefined 调用产生假阳性）
  // -------------------------------------------------------------------------

  it("evaluate 已由 L0C 导出为 function", () => {
    expect(typeof evaluate).toBe("function");
  });

  it("BREAKER_CLAUSES 已由 L0C 导出且为数组", () => {
    expect(Array.isArray(BREAKER_CLAUSES)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 正常：breaker 命中即拦截 + 落安全事件
  // -------------------------------------------------------------------------

  it("rejects deny_to_allow and logs security event", () => {
    expect(typeof evaluate).toBe("function");
    const log = freshLog();
    const diff = makeDiff(
      "packages/l1-config/policies.yaml",
      ["bash: deny"],
      ["bash: allow"],
    );
    const verdict = evaluate(diff, log);
    expectReject(verdict, "deny_to_allow");
    expect(verdict.severity).toBe("critical");

    // 安全事件落 session log（type === 'security_event'）
    const events = securityEvents(log);
    const sec = events.find((e) => e.type === "security_event");
    expect(sec, "security_event must be appended to session log").toBeDefined();
    expect(sec!.payload).toBeTruthy();
  });

  it("rejects safety_segment_deleted and logs security event (critical)", () => {
    const log = freshLog();
    const diff = makeDiff(
      "packages/l1-config/prompts/system.md",
      ["<safety>do not delete</safety>"],
      ["do not delete"],
    );
    const verdict = evaluate(diff, log);
    expectReject(verdict, "safety_segment_deleted");
    expect(verdict.severity).toBe("critical");
    const sec = securityEvents(log).find((e) => e.type === "security_event");
    expect(sec).toBeDefined();
  });

  it("rejects resource_control_model_realloc (critical)", () => {
    const log = freshLog();
    const diff = makeDiff(
      "packages/l1-config/resources.yaml",
      ["resources:", "  control-model: false"],
      ["resources:", "  control-model: true"],
    );
    const verdict = evaluate(diff, log);
    expectReject(verdict, "resource_control_model_realloc");
    expect(verdict.severity).toBe("critical");
  });

  it("rejects acceptance_threshold_widened (warn)", () => {
    const log = freshLog();
    const diff = makeDiff(
      "packages/canary-eval/acceptance.yaml",
      ["acceptance_threshold: 0.8"],
      ["acceptance_threshold: 0.6"],
    );
    const verdict = evaluate(diff, log);
    expectReject(verdict, "acceptance_threshold_widened");
    expect(verdict.severity).toBe("warn");
  });

  // -------------------------------------------------------------------------
  // unsent 跟踪子集 = critical
  // -------------------------------------------------------------------------

  it("flags unsent tracking removal as critical static_core_field_removed", () => {
    const log = freshLog();
    const diff = makeDiff(
      "packages/l0-core/src/run-state/run-state.ts",
      ["  unsent_tool_call_ids_for_interrupted_state: Type.Array(Type.String()),"],
      [],
    );
    const verdict = evaluate(diff, log);
    expectReject(verdict, "static_core_field_removed");
    // unsent 跟踪子集强制 critical（防 resume 重放）
    expect(verdict.severity).toBe("critical");
  });

  it("ordinary static_core_field_removed 也是 critical（默认映射）", () => {
    const log = freshLog();
    const diff = makeDiff(
      "packages/l0-core/src/run-state/run-state.ts",
      ["  current_agent: Type.String(),"],
      [],
    );
    const verdict = evaluate(diff, log);
    expectReject(verdict, "static_core_field_removed");
    expect(verdict.severity).toBe("critical");
  });

  // -------------------------------------------------------------------------
  // 正常：合法 diff 放行
  // -------------------------------------------------------------------------

  it("allows legitimate diff", () => {
    const log = freshLog();
    const diff = makeDiff(
      "packages/l1-config/prompts/foo.md",
      ["old prompt text"],
      ["new prompt text"],
    );
    const verdict = evaluate(diff, log);
    expect(verdict.reject).toBe(false);
    expect(verdict.clauses).toEqual([]);
    expect(verdict.severity).toBe("info");
    // 合法 diff 不落安全事件
    expect(securityEvents(log).length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // meta 自检：breaker 不可改自身
  // -------------------------------------------------------------------------

  it("rejects self-modification of BREAKER_CLAUSES", () => {
    const log = freshLog();
    // 一个试图从 breaker.ts 中移除某 BREAKER_CLAUSES 条目的 diff
    const diff = makeDiff(
      "packages/l0-core/src/guard/breaker.ts",
      [
        '  "safety_segment_deleted", "deny_to_allow", "static_core_field_removed",',
        '  "acceptance_threshold_widened", "resource_control_model_realloc",',
      ],
      [
        '  "deny_to_allow", "static_core_field_removed",',
        '  "acceptance_threshold_widened", "resource_control_model_realloc",',
      ],
    );
    const verdict = evaluate(diff, log);
    expect(verdict.reject).toBe(true);
  });

  it("BREAKER_CLAUSES 覆盖全部五类 DangerousDiffKind（杜绝命名漂移）", () => {
    expect(BREAKER_CLAUSES).toContain("safety_segment_deleted");
    expect(BREAKER_CLAUSES).toContain("deny_to_allow");
    expect(BREAKER_CLAUSES).toContain("static_core_field_removed");
    expect(BREAKER_CLAUSES).toContain("acceptance_threshold_widened");
    expect(BREAKER_CLAUSES).toContain("resource_control_model_realloc");
    expect(BREAKER_CLAUSES.length).toBe(5);
  });

  // -------------------------------------------------------------------------
  // fail-closed：sessionLog 故障不放宽 breaker
  // -------------------------------------------------------------------------

  it("fail-closed when sessionLog throws", () => {
    // 构造一个 append 会抛的 session log（鸭子类型，cast 为 SessionLog）。
    const throwingLog = {
      append(_event: SessionLogEvent): void {
        throw new Error("session log full / disk failure");
      },
      getEvents(_sessionId: string): SessionLogEvent[] {
        return [];
      },
      has(_uuid: string): boolean {
        return false;
      },
    } as unknown as SessionLog;

    const diff = makeDiff(
      "packages/l1-config/policies.yaml",
      ["bash: deny"],
      ["bash: allow"],
    );
    // breaker 必须 fail-closed：log 故障不能放行 → 仍 reject
    const verdict = evaluate(diff, throwingLog);
    expect(verdict.reject).toBe(true);
    expect(verdict.clauses).toContain("deny_to_allow");
  });
});
