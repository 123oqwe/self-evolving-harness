/**
 * L0S-T01 RED — `session log rejects rewrite`
 *
 * Spec source: execution/L0-sandbox/TASKS.md → L0S-T01 行为规范（不变量）+ RED。
 *
 * 不变量（spec）：session log 任何 rewrite 调用 → throw。
 * RED（spec）：`session log rejects rewrite`：调 `append` 后再调 rewrite 风格 API → throw。
 *
 * GREEN（spec）：session log 用 append-only buffer，rewrite API 显式 throw。
 *
 * NOTE: spec 的 `SessionLogDomain` 接口仅声明 `append` 与 `read`，未列出任何 rewrite
 * 风格方法名，也未定义 `LogEntry` 的字段形状。本测试假设实现显式提供 `rewrite` /
 * `update` / `delete` / `truncate` 四个 rewrite 风格方法且各自 throw；并假设 `LogEntry`
 * 至少含 `seq` / `tool_use_id` / `action` / `observation` / `timestamp` 字段。
 * 见返回的 ambiguities 字段。
 */
import { describe, it, expect } from "vitest";
import {
  createSessionLog,
  type Action,
  type LogEntry,
  type Observation,
} from "@harness/l0-sandbox";

function makeEntry(seq: number, tool_use_id: string): LogEntry {
  const action: Action = {
    type: "cmd_run",
    tool_use_id,
    command: "echo hi",
    timeout_ms: 1000,
  };
  const observation: Observation = {
    tool_use_id,
    content: "hi\n",
    exit_code: 0,
    stdout: "hi\n",
    stderr: "",
  };
  return {
    seq,
    tool_use_id,
    action,
    observation,
    timestamp: Date.now(),
  } as LogEntry;
}

async function collect(asyncIterable: AsyncIterable<LogEntry>): Promise<LogEntry[]> {
  const out: LogEntry[] = [];
  for await (const e of asyncIterable) out.push(e);
  return out;
}

describe("L0S-T01", () => {
  describe("session log rejects rewrite", () => {
    it("append adds entries and read returns them in insertion order", async () => {
      const log = createSessionLog({ sessionId: "log-1" });
      log.append(makeEntry(1, "a"));
      log.append(makeEntry(2, "b"));
      log.append(makeEntry(3, "c"));

      const got = await collect(log.read("log-1"));

      expect(got.length).toBe(3);
      expect(got[0]!.tool_use_id).toBe("a");
      expect(got[1]!.tool_use_id).toBe("b");
      expect(got[2]!.tool_use_id).toBe("c");
    });

    it("rewrite throws (append-only enforced)", () => {
      const log = createSessionLog({ sessionId: "log-2" });
      log.append(makeEntry(1, "a"));

      expect(() => (log as unknown as {
        rewrite: (entry: LogEntry) => void;
      }).rewrite(makeEntry(1, "a"))).toThrow();
    });

    it("update throws (append-only enforced)", () => {
      const log = createSessionLog({ sessionId: "log-3" });
      log.append(makeEntry(1, "a"));

      expect(() => (log as unknown as {
        update: (index: number, entry: LogEntry) => void;
      }).update(0, makeEntry(1, "a"))).toThrow();
    });

    it("delete throws (append-only enforced)", () => {
      const log = createSessionLog({ sessionId: "log-4" });
      log.append(makeEntry(1, "a"));

      expect(() => (log as unknown as {
        delete: (index: number) => void;
      }).delete(0)).toThrow();
    });

    it("truncate throws (append-only enforced)", () => {
      const log = createSessionLog({ sessionId: "log-5" });
      log.append(makeEntry(1, "a"));

      expect(() => (log as unknown as {
        truncate: () => void;
      }).truncate()).toThrow();
    });

    it("append after a rejected rewrite still preserves prior entries (no partial mutation)", async () => {
      const log = createSessionLog({ sessionId: "log-6" });
      log.append(makeEntry(1, "a"));
      // 尝试 rewrite —— 必须 throw
      expect(() => (log as unknown as {
        rewrite: (entry: LogEntry) => void;
      }).rewrite(makeEntry(1, "B"))).toThrow();
      // rewrite 失败不得改变已持久化的条目
      log.append(makeEntry(2, "b"));
      const got = await collect(log.read("log-6"));
      expect(got.length).toBe(2);
      expect(got[0]!.tool_use_id).toBe("a");
      expect(got[1]!.tool_use_id).toBe("b");
    });
  });
});
