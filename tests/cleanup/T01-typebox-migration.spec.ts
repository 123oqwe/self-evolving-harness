// CLN-T01 · L0C-T03/T06 schema 迁移真 typebox [Wave 2 前置]
//
// Spec: execution/cleanup/TASKS.md §CLN-T01
// SUT: packages/l0-core 的 StopReason / StopDecision / MemoryCommand schema 导出
//
// 任务背景：L0C-T03/T06 当前把 schema 以 *手写 frozen 描述符对象*（或纯
// `type` 别名）导出，运行时校验靠手动代码。本清理任务把它们迁移为真正的
// `@sinclair/typebox` `Type.Object` / `Type.Union` 定义，使运行时校验与编译期
// TS 类型同源（`Static<typeof X>`），并保留对外契约（锁定测试仍 GREEN）。
//
// RED 形态（当前）：`StopReason` / `StopDecision` / `MemoryCommand` 都是 *纯
// 类型* 导出（`export type` / `export interface`），运行时绑定 = `undefined`；
// 因此 `expect(...).toBeDefined()` 失败，`Value.Check(...)` 抛 "Unknown type"
// → 全部 RED。迁移完成后三者成为 typebox schema 值 → GREEN。
//
// 注：本测试不直接 `import "@sinclair/typebox"`（pnpm 严格隔离下根级测试
// 无法解析该包）。typebox 通过 `@harness/l0-core` 自身的 node_modules 解析，
// 保证测试在迁移前后都能加载到 `Value.Check`（迁移前 schema 非 typebox →
// Check 抛错 = RED；迁移后 schema 真 typebox → Check 返回布尔 = GREEN）。
//
// 断言逻辑在迁移完成后能真正检验行为：测的是「schema 是真 typebox 对象 +
// Value.Check 的 accept/reject 语义」，不测实现细节。

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── 通过 @harness/l0-core 的 node_modules 解析 typebox 的 Value 校验器 ──
const HERE = dirname(fileURLToPath(import.meta.url));
const L0_CORE_DIR = resolve(HERE, "../../packages/l0-core");
const l0Require = createRequire(import.meta.url);
const typeboxValuePath = l0Require.resolve("@sinclair/typebox/value", {
  paths: [L0_CORE_DIR],
});
const { Value } = l0Require(typeboxValuePath) as {
  Value: {
    Check: <T>(schema: T, value: unknown) => boolean;
  };
};

import {
  validateMemoryCommand,
  assertStrReplaceUnique,
} from "@harness/l0-core";
import type {
  StopReason as StopReasonType,
  StopDecision as StopDecisionType,
  MemoryCommand as MemoryCommandType,
} from "@harness/l0-core";

// 同名的 *值* 导出通过动态 import 取回（`any` 绕过「类型不可作值」的 TS
// 报错，且无 @ts-expect-error 在迁移后变成 unused 的隐患）。迁移前运行时
// 绑定 = `undefined`（RED 根因）；迁移后它们是 typebox schema 对象。
const L0: any = await import("@harness/l0-core");
const StopReason = L0.StopReason;
const StopDecision = L0.StopDecision;
const MemoryCommand = L0.MemoryCommand;

/** typebox schema 的 Kind 符号名（TypeBox 内部 marker）。 */
const TYPEBOX_KIND = "Symbol(TypeBox.Kind)";
function isTypeboxSchema(x: unknown): boolean {
  if (x === null || typeof x !== "object") return false;
  const syms = Object.getOwnPropertySymbols(x).map(String);
  return syms.includes(TYPEBOX_KIND);
}

// ---------------------------------------------------------------------------
// CLN-T01 · StopReason / StopDecision（L0C-T03 schema）
// ---------------------------------------------------------------------------

describe("CLN-T01 · L0C-T03 StopReason/StopDecision 迁移真 typebox", () => {
  it("Given 迁移完成，When 取 StopReason 导出，Then 它是 typebox Union schema 值", () => {
    // Given/When/Then：StopReason 须是运行时可用的 typebox schema（非 undefined
    // 纯类型），且 kind 标记为 Union。
    // 注：typebox 0.34 的 Type.Union 不设 `type` 字段（仅 `anyOf`），故用
    // anyOf 兜底（与下方 MemoryCommand 断言同源），避免对 typebox 内部形状
    // 的过度耦合导致迁移正确却永远 RED。
    expect(StopReason).toBeDefined();
    expect(isTypeboxSchema(StopReason)).toBe(true);
    const schema = StopReason as { type?: string; anyOf?: unknown[] };
    expect(schema.type === "union" || Array.isArray(schema.anyOf)).toBe(true);
  });

  it("Given 迁移完成，When 取 StopDecision 导出，Then 它是 typebox Object schema 值", () => {
    expect(StopDecision).toBeDefined();
    expect(isTypeboxSchema(StopDecision)).toBe(true);
    const schema = StopDecision as {
      type?: string;
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(schema.type).toBe("object");
    // 对外契约不变：stop / layer / reason 三字段（与锁定 T03 测试同源）。
    expect(schema.properties).toBeDefined();
    expect(Object.keys(schema.properties!)).toEqual(
      expect.arrayContaining(["stop", "layer", "reason"]),
    );
    expect(schema.required).toEqual(
      expect.arrayContaining(["stop", "layer", "reason"]),
    );
  });

  it("Given 合法 StopDecision，When Value.Check，Then 通过（exit 0 语义）", () => {
    // 使用与现有锁定 T03 契约一致的 layer 字面量（end_turn，新旧形态共有）。
    const valid: StopDecisionType = {
      stop: true,
      layer: "end_turn",
      reason: "end_turn signal at turn 0",
    };
    expect(Value.Check(StopDecision, valid)).toBe(true);
  });

  it("Given StopDecision 缺字段 / 类型错 / 多余字段，When Value.Check，Then reject", () => {
    // 缺 reason
    expect(
      Value.Check(StopDecision, { stop: true, layer: "end_turn" }),
    ).toBe(false);
    // stop 类型错（非 boolean）
    expect(
      Value.Check(StopDecision, {
        stop: "yes",
        layer: "end_turn",
        reason: "x",
      }),
    ).toBe(false);
    // reason 类型错
    expect(
      Value.Check(StopDecision, { stop: true, layer: "end_turn", reason: 42 }),
    ).toBe(false);
    // 多余字段（additionalProperties:false 语义保留）
    expect(
      Value.Check(StopDecision, {
        stop: true,
        layer: "end_turn",
        reason: "x",
        extra: "no",
      }),
    ).toBe(false);
  });

  it("Given 合法 StopReason 字面量，When Value.Check(StopReason, v)，Then 通过；非法字面量 reject", () => {
    // 取现有契约内的合法 stop_reason 字面量。end_turn 与 max_turns 在 spec
    // 签名 / StopLayer / StopReason 三处解释下均为合法成员，覆盖这两个以
    // 防止实现把 union 收窄到仅 end_turn 蒙混过关（不可蒙混）。
    const valid: StopReasonType = "end_turn";
    expect(Value.Check(StopReason, valid)).toBe(true);
    expect(Value.Check(StopReason, "max_turns")).toBe(true);
    // 非法字面量
    expect(Value.Check(StopReason, "definitely_not_a_reason")).toBe(false);
    expect(Value.Check(StopReason, 123)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CLN-T01 · MemoryCommand（L0C-T06 六命令 schema）
// ---------------------------------------------------------------------------

describe("CLN-T01 · L0C-T06 MemoryCommand 迁移真 typebox", () => {
  it("Given 迁移完成，When 取 MemoryCommand 导出，Then 它是 typebox Union schema 值", () => {
    expect(MemoryCommand).toBeDefined();
    expect(isTypeboxSchema(MemoryCommand)).toBe(true);
    const schema = MemoryCommand as { type?: string; anyOf?: unknown[] };
    expect(schema.type === "union" || Array.isArray(schema.anyOf)).toBe(true);
  });

  it("Given 六命令各自合法 input，When Value.Check(MemoryCommand, v)，Then 全部通过", () => {
    // 六命令字面量与现有锁定 T06 契约一致（command 字段判别）。
    const valid: MemoryCommandType[] = [
      { command: "view", path: "/memories/foo" },
      { command: "create", path: "/memories/notes.md", content: "# notes" },
      {
        command: "str_replace",
        path: "/memories/notes.md",
        old_str: "a",
        new_str: "b",
      },
      {
        command: "insert",
        path: "/memories/notes.md",
        insert_line: 1,
        content: "x",
      },
      { command: "delete", path: "/memories/notes.md" },
      { command: "rename", path: "/memories/old.md", new_path: "/memories/new.md" },
    ];
    for (const input of valid) {
      expect(Value.Check(MemoryCommand, input)).toBe(true);
    }
  });

  it("Given 非法 command / 缺字段 / 类型错 / 多余字段，When Value.Check，Then reject（与原 frozen 守卫同路径）", () => {
    // 未知 command
    expect(Value.Check(MemoryCommand, { command: "no_such" })).toBe(false);
    // create 缺 content
    expect(
      Value.Check(MemoryCommand, { command: "create", path: "/memories/x" }),
    ).toBe(false);
    // insert.insert_line 类型错（应 number）
    expect(
      Value.Check(MemoryCommand, {
        command: "insert",
        path: "/memories/x",
        insert_line: "one",
        content: "y",
      }),
    ).toBe(false);
    // str_replace 多余字段（additionalProperties:false）
    expect(
      Value.Check(MemoryCommand, {
        command: "str_replace",
        path: "/memories/x",
        old_str: "a",
        new_str: "b",
        evil: true,
      }),
    ).toBe(false);
    // command 字段本身类型错
    expect(Value.Check(MemoryCommand, { command: 1 })).toBe(false);
  });

  it("Given 迁移后 validateMemoryCommand 行为不变，When 跑原守卫，Then accept/reject 与 Value.Check 同源", () => {
    // 迁移不得改变对外契约：validateMemoryCommand 仍 reject/accept 同一组输入。
    expect(
      validateMemoryCommand({
        command: "str_replace",
        path: "/memories/x",
        old_str: "a",
        new_str: "b",
      }).ok,
    ).toBe(true);
    expect(
      validateMemoryCommand({ command: "create", path: "/memories/x" }).ok,
    ).toBe(false);
    expect(validateMemoryCommand({ command: "nope" }).ok).toBe(false);
  });

  it("Given str_replace 的 old_str 在 content 中出现 0 次或 ≥2 次，When assertStrReplaceUnique，Then reject（恰好 1 次 → 通过）", () => {
    // ERRATA-w01 §L0C-T06-A3：old_str 唯一性守卫行为在迁移后必须保持。
    // 0 次 → reject
    expect(() => assertStrReplaceUnique("bbb", "a")).toThrow();
    // ≥2 次 → reject
    expect(() => assertStrReplaceUnique("aba", "a")).toThrow();
    expect(() => assertStrReplaceUnique("aaa", "a")).toThrow();
    // 恰好 1 次 → 通过（不抛）
    expect(() => assertStrReplaceUnique("xabx", "ab")).not.toThrow();
  });
});
