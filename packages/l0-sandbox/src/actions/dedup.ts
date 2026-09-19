/**
 * L0S-T01 — tool_use_id 去重幂等表
 *
 * key = `<sessionId>:<tool_use_id>`（裁决 GREEN：tool_use_id 去重表 key=`runId:tool_use_id`）。
 * wake 重放时跳过已持久化 tool_use_id；同一 tool_use_id 不重执行 → 重复副作用计数=0。
 */

import type { Observation } from "./protocol.js";

export class ToolUseIdDedup {
  private readonly index = new Map<string, Observation>();

  constructor(private readonly sessionId: string) {}

  private key(toolUseId: string): string {
    return `${this.sessionId}:${toolUseId}`;
  }

  has(toolUseId: string): boolean {
    return this.index.has(this.key(toolUseId));
  }

  get(toolUseId: string): Observation | undefined {
    return this.index.get(this.key(toolUseId));
  }

  set(toolUseId: string, obs: Observation): void {
    this.index.set(this.key(toolUseId), obs);
  }

  size(): number {
    return this.index.size;
  }
}
