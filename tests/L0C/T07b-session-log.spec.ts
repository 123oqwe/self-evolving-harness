import { describe, it, expect } from "vitest";
import {
  SessionLog,
  wake,
  WriteDeltaJournal,
  type SessionLogEvent,
} from "@harness/l0-core";

/**
 * L0C-T07b — session log append-only 契约 + wake 重水化 +
 * per-agent WRITE DELTA journal.
 *
 * SUT: packages/l0-core/src/session-log/session-log.ts +
 *      packages/l0-core/src/run-state/journal.ts
 *
 * 这些测试在模块实现前为合法 RED（import 失败）；实现完成后应全部转绿。
 */

// ── test helpers ────────────────────────────────────────────────────────

let counter = 0;
function makeEvent(
  overrides: Partial<SessionLogEvent> & Pick<SessionLogEvent, "sessionId">,
): SessionLogEvent {
  counter += 1;
  return {
    uuid: `evt-${counter}`,
    parentUuid: null,
    type: "generic",
    ts: counter,
    payload: { n: counter },
    ...overrides,
  };
}

// ── L0C-T07b ────────────────────────────────────────────────────────────

describe("L0C-T07b", () => {
  describe("SessionLog append-only contract", () => {
    it("append makes has return true", () => {
      // Given 空 session log；When append 一个 event；Then has(uuid)===true（正常路径）
      const log = new SessionLog();
      const evt = makeEvent({ sessionId: "s1" });

      expect(log.has(evt.uuid)).toBe(false);
      log.append(evt);

      expect(log.has(evt.uuid)).toBe(true);
    });

    it("append-only rejects rewrite", () => {
      // Given 已存在 uuid；When append 同 uuid；Then throw（错误路径：append-only 违约）
      const log = new SessionLog();
      const evt = makeEvent({ sessionId: "s1", uuid: "dup-uuid" });
      log.append(evt);

      const second = { ...evt, payload: { mutated: true } };
      expect(() => log.append(second)).toThrow();

      // 状态一致性：原 event 不被覆写，计数仍为 1
      const events = log.getEvents("s1");
      expect(events).toHaveLength(1);
      expect(events[0]!.payload).toEqual(evt.payload);
    });

    it("parentUuid branch traceable", () => {
      // Given parentUuid 形成 branch/fork；When getEvents；Then 可追溯 fork 链（边界：对话树）
      const log = new SessionLog();
      const root = makeEvent({ sessionId: "s1", uuid: "root", parentUuid: null });
      const childA = makeEvent({
        sessionId: "s1",
        uuid: "childA",
        parentUuid: "root",
        type: "branch-a",
      });
      const childB = makeEvent({
        sessionId: "s1",
        uuid: "childB",
        parentUuid: "root",
        type: "branch-b",
      });
      log.append(root);
      log.append(childA);
      log.append(childB);

      const events = log.getEvents("s1");

      // 构建 uuid -> event 索引以追溯 fork 链
      const byUuid = new Map(events.map((e) => [e.uuid, e]));
      expect(byUuid.size).toBe(3);

      // 两个分支 sibling 共享同一 fork 点 (root)
      const a = byUuid.get("childA")!;
      const b = byUuid.get("childB")!;
      expect(a.parentUuid).toBe("root");
      expect(b.parentUuid).toBe("root");
      expect(a.parentUuid).toBe(b.parentUuid); // 同一 fork 点

      // 沿 parentUuid 链从每个叶子回溯到根 (parentUuid===null)
      function traceToRoot(start: string): string[] {
        const chain: string[] = [];
        let cur: string | null = start;
        const guard = new Set<string>();
        while (cur !== null) {
          if (guard.has(cur)) throw new Error(`cycle at ${cur}`);
          guard.add(cur);
          chain.push(cur);
          const node = byUuid.get(cur);
          if (!node) throw new Error(`dangling parent ${cur}`);
          cur = node.parentUuid;
        }
        return chain;
      }

      expect(traceToRoot("childA")).toEqual(["childA", "root"]);
      expect(traceToRoot("childB")).toEqual(["childB", "root"]);
      // root 自身为根
      expect(byUuid.get("root")!.parentUuid).toBeNull();
    });
  });

  describe("wake rehydration", () => {
    it("wake rehydrates equivalent state", () => {
      // Given crash 前 log 含 5 events；When 新 harness wake(sessionLog, sessionId)；
      // Then 返回等价 5 events（正常：重水化）
      const log = new SessionLog();
      const sessionId = "sess-crash";
      const original: SessionLogEvent[] = [];
      let parent: string | null = null;
      for (let i = 0; i < 5; i++) {
        const evt = makeEvent({
          sessionId,
          uuid: `crash-${i}`,
          parentUuid: parent,
          type: `step-${i}`,
          ts: 1000 + i,
          payload: { i, marker: `m${i}` },
        });
        original.push(evt);
        log.append(evt);
        parent = evt.uuid;
      }
      // 干扰项：另一 session 的事件不得混入 rehydrate 结果
      log.append(makeEvent({ sessionId: "other", uuid: "other-0" }));

      const { events } = wake(log, sessionId);

      expect(events).toHaveLength(5);
      // 等价：逐条 uuid / type / parentUuid / ts / payload 一致，且顺序可重建原链
      expect(events.map((e) => e.uuid)).toEqual(original.map((e) => e.uuid));
      for (let i = 0; i < original.length; i++) {
        const got = events[i]!;
        const want = original[i]!;
        expect(got.uuid).toBe(want.uuid);
        expect(got.parentUuid).toBe(want.parentUuid);
        expect(got.type).toBe(want.type);
        expect(got.ts).toBe(want.ts);
        expect(got.payload).toEqual(want.payload);
        expect(got.sessionId).toBe(sessionId);
      }
    });
  });

  describe("WriteDeltaJournal", () => {
    it("journal replays in completion order", () => {
      // Given 两个并行 agent A/B，A 完成序在前；When journal 写 A:0, B:0, A:1；
      // When replay([{A,0},{B,0},{A,1}])；Then 按 A:0→B:0→A:1 序返回（边界：完成序正确）
      const journal = new WriteDeltaJournal();
      journal.write("A", 0, "a0");
      journal.write("B", 0, "b0");
      journal.write("A", 1, "a1");

      const completionOrder = [
        { runId: "A", callIndex: 0 },
        { runId: "B", callIndex: 0 },
        { runId: "A", callIndex: 1 },
      ];
      const replayed = journal.replay(completionOrder);

      expect(replayed).toHaveLength(3);
      expect(replayed).toEqual(["a0", "b0", "a1"]);
      // 完成序而非发起序：A:0 先于 B:0 先于 A:1
      expect(replayed[0]).toBe("a0");
      expect(replayed[1]).toBe("b0");
      expect(replayed[2]).toBe("a1");
    });

    it("journal rejects conflicting key", () => {
      // Given 同 key A:0 被 write 两次；When assertNoConflict；Then throw（错误路径：冲突）
      const journal = new WriteDeltaJournal();
      journal.write("A", 0, "first");
      journal.write("A", 0, "second"); // 同 `${runId}:${callIndex}` 冲突

      expect(() => journal.assertNoConflict()).toThrow();

      // 对照：不同 key 不冲突
      const clean = new WriteDeltaJournal();
      clean.write("A", 0, "a0");
      clean.write("A", 1, "a1");
      clean.write("B", 0, "b0");
      expect(() => clean.assertNoConflict()).not.toThrow();
    });
  });
});
