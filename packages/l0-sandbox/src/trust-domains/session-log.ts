/**
 * L0S-T01 — append-only session log 域 + `wake` 重水化支撑
 *
 * 不变量：session log 任何 rewrite 调用 → throw。
 * crash 后新 harness 复用同一持久 buffer，`wake(sessionId)` 重水化 RunState，
 * 重复副作用计数=0（同一 tool_use_id 不重执行）。
 */

import type { LogEntry } from "../actions/protocol.js";

/** Session log 信任域接口。 */
export interface SessionLogDomain {
  /** append-only 追加；禁 rewrite。 */
  append(entry: LogEntry): void;
  /** 按插入顺序读回条目（async iterable）。 */
  read(sessionId: string): AsyncIterable<LogEntry>;
  /** rewrite 风格 API：必须显式存在且一律 throw（append-only 强制）。 */
  rewrite(entry: LogEntry): never;
  update(index: number, entry: LogEntry): never;
  delete(index: number): never;
  truncate(): never;
}

/**
 * 创建一个 append-only session log。
 *
 * @param opts.sessionId 该 session 的标识。
 * @param opts.buffer   跨 brain 实例共享的可变数组，模拟 crash 后复用同一 session 持久状态
 *                      （裁决 L0S-T01-A9）。省略则内部新建一个数组。
 */
export function createSessionLog(opts: {
  sessionId: string;
  buffer?: LogEntry[];
}): SessionLogDomain {
  const buffer: LogEntry[] = opts.buffer ?? [];

  const log: SessionLogDomain = {
    append(entry: LogEntry): void {
      buffer.push(entry);
    },

    async *read(_sessionId: string): AsyncIterable<LogEntry> {
      // append-only buffer 按插入顺序 yield；read 形参 sessionId 保留接口契约，
      // 本 session log 实例本身已绑定单一 sessionId，故不二次过滤。
      for (const entry of buffer) {
        yield entry;
      }
    },

    rewrite(_entry: LogEntry): never {
      throw new Error("session log is append-only: rewrite forbidden");
    },

    update(_index: number, _entry: LogEntry): never {
      throw new Error("session log is append-only: update forbidden");
    },

    delete(_index: number): never {
      throw new Error("session log is append-only: delete forbidden");
    },

    truncate(): never {
      throw new Error("session log is append-only: truncate forbidden");
    },
  };

  return log;
}
