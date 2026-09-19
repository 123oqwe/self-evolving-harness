/**
 * L0C-T04 · 重试 + 溢出恢复 guard —— test-author 出题（RED）
 *
 * 依据 spec：execution/L0-core/TASKS.md § L0C-T04
 * 测试根：packages/l0-core/tests/L0C/（WBS 附录 A.2）
 * 导入包名：@harness/l0-core
 *
 * 当前模块尚未实现（src/index.ts 仍为 placeholder），import 将失败 —— 这是合法 RED。
 * 实现完成后，下列断言将真正检验：retry counter reset-on-success / 可重试错误分类 /
 * OverflowGuard 单次锁 / dispose 即便 hook throw 仍 abort AbortController / reset 仅在
 * 非 error 且非 length 的 stopReason 下生效。
 */
import { describe, it, expect, vi } from "vitest";
import {
  // 可重试错误分类（WBS §2 契约表导出符号 isRetryableError）
  isRetryableError,
  // retry counter reset-on-success
  RetryCounter,
  // 溢出恢复单次锁 + AbortController dispose
  OverflowGuard,
  // 类型
  type ApiError,
  type StopReason,
} from "@harness/l0-core";

/**
 * 构造最小 ApiError 的 helper。
 *
 * 注意（spec 歧义 #1，见 ambiguities）：T04 spec 仅给出 `RetryClassifier.isRetryable(err: ApiError)`
 * 签名但未定义 `ApiError` 的字段集。本测试依据行为规范中 "429 error" / "400 invalid_request"
 * 以及 GREEN 提示 `RETRYABLE_STATUS = new Set([429, 503, 408])`，假定 ApiError 至少含
 * `statusCode: number` 与可选 `message`。若实现把 ApiError 字段命名为其它（如 `status`），
 * 需在实现侧统一并回填本测试的构造方式。
 */
function makeApiError(statusCode: number, message = ""): ApiError {
  return { statusCode, message } as unknown as ApiError;
}

describe("L0C-T04", () => {
  // ───────────────────────────────────────────────────────────────────────────
  // GWT1 / RED: resets retry counter on success
  // Given 连续 3 次 429 error；When 每次 onRetryableError + 最终一次成功 onSuccess；
  // Then counter.attempt 从 3 归零为 0（reset-on-success，正常路径）。
  // ───────────────────────────────────────────────────────────────────────────
  it("resets retry counter on success", () => {
    const counter = new RetryCounter();

    counter.onRetryableError();
    expect(counter.attempt).toBe(1);
    counter.onRetryableError();
    expect(counter.attempt).toBe(2);
    counter.onRetryableError();
    expect(counter.attempt).toBe(3);

    // 成功后必须归零——这是崩溃恢复不变量（reset-on-success 不可改）。
    counter.onSuccess();
    expect(counter.attempt).toBe(0);

    // 归零后再次可重试错误应从 1 重新计数（计数器非一次性）。
    counter.onRetryableError();
    expect(counter.attempt).toBe(1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GWT2 / RED: classifies 429 retryable, 400 not
  // Given 非 429（如 400 invalid_request）；When isRetryable；Then false
  // （错误路径：不可重试直接走 stop unrecoverable_error）。
  // ───────────────────────────────────────────────────────────────────────────
  it("classifies 429 retryable, 400 not", () => {
    // 429 (rate limit) 可重试
    expect(isRetryableError(makeApiError(429, "rate_limit_error"))).toBe(true);
    // 400 invalid_request 不可重试——对应 provider 400，直接 unrecoverable_error
    expect(isRetryableError(makeApiError(400, "invalid_request"))).toBe(false);

    // GREEN 提示 RETRYABLE_STATUS = new Set([429, 503, 408])——补验 503 / 408 可重试，
    // 以及一个明确不可重试的 500。
    expect(isRetryableError(makeApiError(503, "overloaded_error"))).toBe(true);
    expect(isRetryableError(makeApiError(408, "request_timeout"))).toBe(true);
    expect(isRetryableError(makeApiError(500, "internal_server_error"))).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GWT3 + GWT4 / RED: overflow guard single-shot lock
  // Given stop_reason==='length' 触发 compaction；When beginCompaction 第一次；
  //      Then true 且 attempted=true。
  // Given 已 attempted；When 再次 beginCompaction（再次 length overflow）；
  //      Then false（单次锁，防无限 compaction 循环）。
  // ───────────────────────────────────────────────────────────────────────────
  it("overflow guard single-shot lock", () => {
    const guard = new OverflowGuard();

    // 初始未尝试过 compaction 恢复。
    expect(guard.attempted).toBe(false);

    // 第一次 length overflow → 允许一次 compaction 恢复。
    expect(guard.beginCompaction()).toBe(true);
    expect(guard.attempted).toBe(true);

    // 再次 length overflow → 单次锁拒绝，防止无限 compaction 循环。
    expect(guard.beginCompaction()).toBe(false);
    // 锁定状态保持，不因再次调用而翻转。
    expect(guard.attempted).toBe(true);
    expect(guard.beginCompaction()).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GWT5 / RED: dispose aborts even if hook throws
  // Given compaction hook throw；When dispose；Then AbortController 仍被 abort
  // （finally 块），无泄漏（边界）。
  //
  // 注意（spec 歧义 #2/#3，见 ambiguities）：
  //  - spec 接口签名 `dispose(): Promise<void>` 未声明 hook 形参，但 GREEN 提示
  //    `try { await hook() } finally { abort() }` 又表明 dispose 需运行一个 hook。
  //  - spec 未声明如何向 OverflowGuard 注入 / 暴露 AbortController，但断言要点要求
  //    `AbortController.aborted===true`，测试必须能观察到该 controller。
  //  本测试据此约定：构造器接受可选 `{ abortController?, onDispose? }`，dispose 在
  //  finally 中 abort 该 controller。若实现采用别的注入方式（如 dispose(hook) 形参），
  //  需统一契约并回填本测试。
  // ───────────────────────────────────────────────────────────────────────────
  it("dispose aborts even if hook throws", async () => {
    const abortController = new AbortController();
    const hookError = new Error("compaction hook exploded");
    const onDispose = vi.fn(async () => {
      throw hookError;
    });

    const guard = new OverflowGuard({ abortController, onDispose });

    // spec Then 仅要求不变量：即便 hook throw，AbortController 仍被 abort（finally 块），
    // 无泄漏。GREEN 提示 `try { await hook() } finally { abort() }` 在 hook throw 时会
    // rethrow（promise rejects），故 dispose 既可能 rethrow 也可能 swallow——均为合法实现。
    // 因此不锁死 `resolves.toBeUndefined()` 吞错语义，只断言 spec 要求的不变量。
    await guard.dispose().catch(() => {});

    // 关键不变量：即便 hook throw，AbortController 仍被 abort（finally 块），无泄漏。
    expect(abortController.signal.aborted).toBe(true);
    // hook 确实被调用过（dispose 不是空操作）。
    expect(onDispose).toHaveBeenCalledTimes(1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GWT6 / RED: reset only on non-error non-length stop
  // Given stop_reason==='end_turn'；When reset；Then attempted=false
  // （只有非 error/非 length 才 reset）。
  // 对应负向：length stop 不 reset（保持锁）。
  //
  // 注意（spec 歧义 #4，见 ambiguities）：spec 接口签名 `reset(): void` 无形参，
  // 但行为规范以 stop_reason 为 reset 的判定条件。GREEN/执行提示 ① 明确
  // "reset 条件严格按 pi 注释：非 error 且非 length stop 才 reset"——即 reset 需知道
  // stopReason。
  //
  // 契约对齐决策（按审查意见 GWT6）：spec 接口声明 `reset(): void` 与行为规范矛盾——
  // 行为必须有 stopReason 才能判定是否 reset。本测试采用唯一能满足行为规范的形态
  // `reset(stopReason: StopReason): void`，并要求实现侧同步 spec 接口声明为此签名
  // （消除 'reset(): void' 与行为规范的矛盾）。实现侧不得保留无参 `reset(): void`，
  // 否则无法表达 reset 条件，测试与 spec Then 将无法满足。
  // 仅当 stopReason 既非 'error' 又非 'length' 时才清 attempted 锁。
  // ───────────────────────────────────────────────────────────────────────────
  it("reset only on non-error non-length stop", () => {
    const guard = new OverflowGuard();
    // 先触发一次 compaction 锁定。
    expect(guard.beginCompaction()).toBe(true);
    expect(guard.attempted).toBe(true);

    // length stop：不得 reset（锁保持，防 overflow 恢复未完成又被错误清空）。
    guard.reset("length" as StopReason);
    expect(guard.attempted).toBe(true);

    // error stop：同样不得 reset。
    guard.reset("error" as StopReason);
    expect(guard.attempted).toBe(true);

    // end_turn stop（非 error 且非 length）：reset 生效，锁清空。
    guard.reset("end_turn" as StopReason);
    expect(guard.attempted).toBe(false);

    // reset 后单次锁可再次启用（一个 turn 内最多一次，跨 turn 重新可用）。
    expect(guard.beginCompaction()).toBe(true);
    expect(guard.attempted).toBe(true);
  });
});
