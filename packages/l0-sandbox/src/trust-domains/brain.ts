/**
 * L0S-T01 — Brain 信任域 facade + createBrain 工厂
 *
 * 不变量（裁决 L0S-T01-A2 vault 解释）：
 *   - 真实凭据经 `secrets` 注册到 brain 进程内部 vault（内存 Map），**绝不写入 process.env**；
 *   - brain 仅向 hands runner 传递已 strip 真实 secret 的 sandbox env；
 *   - 故「brain 进程 env grep 真实 secret = 0」在 execute 前/中/后均成立。
 *
 * execute(name, input) 的 name 语义（裁决 L0S-T01-A7）：
 *   - name 是调用目标/agent 标识，MVP 阶段唯一合法值 `'hands'`；其它值由 brain 拒绝
 *     并返回 `Observation.error='unknown_target'`。
 *
 * tool_use_id 去重幂等（裁决 GREEN）：
 *   - key=`runId:tool_use_id`；同一 tool_use_id 不重执行；
 *   - wake(sessionId) 重水化 RunState 时从 session log 重建去重表，重复副作用计数=0。
 */

import type {
  Action,
  LogEntry,
  Observation,
  RunState,
  SessionEvent,
} from "../actions/protocol.js";
import { ToolUseIdDedup } from "../actions/dedup.js";
import type { SessionLogDomain } from "./session-log.js";
import { createHands, HANDS_UNAVAILABLE, type HandsDomain } from "./hands.js";

/** 命令执行器（可注入，供测试隔离）。 */
export interface CmdRunner {
  run(
    command: string,
    opts: {
      env: Record<string, string>;
      cwd: string;
      timeout_ms: number;
    },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

/** 不支持的调用目标。 */
export const UNKNOWN_TARGET = "unknown_target" as const;

export interface BrainDomain {
  execute(name: string, input: Action): Promise<Observation>;
  emitEvent(e: SessionEvent): void;
  getEvents(since: number): SessionEvent[];
  wake(sessionId: string): Promise<RunState>;
}

/** createBrain 构造选项。 */
export interface CreateBrainOpts {
  sessionId: string;
  /** 真实凭据 → brain 内部 vault，绝不写入 process.env（裁决 L0S-T01-A2） */
  secrets: Record<string, string>;
  /** hands 域命令执行器（可注入，供测试隔离） */
  runner: CmdRunner;
  sessionLog: SessionLogDomain;
}

export function createBrain(opts: CreateBrainOpts): BrainDomain {
  const { sessionId, runner, sessionLog } = opts;
  // 真实凭据 vault：内存 Map，永不写入 process.env，永不序列化进 hands/session log。
  const vault = new Map<string, string>(Object.entries(opts.secrets));
  const dedup = new ToolUseIdDedup(sessionId);
  const events: SessionEvent[] = [];
  const hands: HandsDomain = createHands(runner);

  // 经 globalThis 取 node process，避免对 @types/node 的硬依赖（MVP 自包含构建）。
  const nodeProcess = (globalThis as unknown as {
    process: {
      env: Record<string, string | undefined>;
      cwd(): string;
    };
  }).process;

  let hydrated = false;
  let seqCounter = 0;

  /** 从 session log 重水化去重表（crash 后新 harness 复用同一持久 buffer）。 */
  async function ensureHydrated(): Promise<void> {
    if (hydrated) return;
    hydrated = true;
    for await (const entry of sessionLog.read(sessionId)) {
      if (!dedup.has(entry.tool_use_id)) {
        dedup.set(entry.tool_use_id, entry.observation);
      }
      if (entry.seq > seqCounter) seqCounter = entry.seq;
    }
  }

  /** 构建 hands sandbox env：strip 真实 secret，绝不透传真实凭据。 */
  function buildSandboxEnv(): Record<string, string> {
    const env: Record<string, string> = {
      ...nodeProcess.env,
    } as Record<string, string>;
    for (const key of vault.keys()) {
      delete env[key];
    }
    return env;
  }

  function nextSeq(): number {
    return ++seqCounter;
  }

  return {
    async execute(name: string, input: Action): Promise<Observation> {
      // 裁决 L0S-T01-A7：name 唯一合法值 'hands'
      if (name !== "hands") {
        return {
          tool_use_id: input.tool_use_id,
          content: "",
          exit_code: 1,
          stdout: "",
          stderr: "",
          error: UNKNOWN_TARGET,
        };
      }

      // wake/重水化：同一 tool_use_id 不重执行
      await ensureHydrated();
      const cached = dedup.get(input.tool_use_id);
      if (cached) {
        return cached;
      }

      const env = buildSandboxEnv();
      const cwd = nodeProcess.cwd();

      const obs = await hands.execute(input, { env, cwd });

      // 仅成功的 observation 持久化+去重（crash/unsupported 不缓存，允许后续重试）
      if (obs.error === undefined) {
        dedup.set(input.tool_use_id, obs);
        const entry: LogEntry = {
          seq: nextSeq(),
          tool_use_id: input.tool_use_id,
          action: input,
          observation: obs,
          timestamp: Date.now(),
        };
        sessionLog.append(entry);
      } else if (obs.error === HANDS_UNAVAILABLE) {
        events.push({
          type: "hands_crashed",
          sessionId,
          ts: Date.now(),
          payload: { tool_use_id: input.tool_use_id },
        });
      }

      return obs;
    },

    emitEvent(e: SessionEvent): void {
      events.push(e);
    },

    getEvents(since: number): SessionEvent[] {
      return events.filter((e) => e.ts >= since);
    },

    async wake(_sessionId: string): Promise<RunState> {
      await ensureHydrated();
      return {
        version: "1",
        current_agent: "hands",
        _current_turn: dedup.size(),
        pending_input: null,
        unsent_tool_call_ids_for_interrupted_state: [],
        approvals: {},
        turnItems: [],
      };
    },
  };
}
