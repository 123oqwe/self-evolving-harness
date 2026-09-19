/**
 * L0S-T01 RED — `wake does not re-execute tools`
 *
 * Spec source: execution/L0-sandbox/TASKS.md → L0S-T01 行为规范（边界）+ RED。
 *
 * 边界（spec）：Given 同一 session 内多次 execute；When wake(sessionId) 重水化；
 * Then 重放后重复副作用计数=0（同一 tool_use_id 不重执行）。
 *
 * GREEN 暗示（spec）：tool_use_id 去重表 key=`runId:tool_use_id`；wake 重放时跳过
 * 已持久化 tool_use_id；session log 用 append-only buffer。
 *
 * NOTE: spec 未定义 SessionLogDomain 的构造/持久化 API。本测试假设 `createSessionLog`
 * 接受 `buffer` 选项（跨 brain 实例共享的可变数组），用以模拟 crash 后新 harness 复用
 * 同一 session 持久状态。见返回的 ambiguities 字段。
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  createBrain,
  createSessionLog,
  type Action,
  type BrainDomain,
  type CmdRunner,
  type LogEntry,
  type Observation,
} from "@harness/l0-sandbox";

function cmdRun(tool_use_id: string, command: string, timeout_ms = 5000): Action {
  return { type: "cmd_run", tool_use_id, command, timeout_ms };
}

/**
 * 计数执行器：每次真实执行都计数（副作用计数器）。echo 在 macOS/Linux 均可用，
 * 输出确定（`echo first` → `first\n`）。
 */
function makeCountingRunner(): {
  runner: CmdRunner;
  getCount: () => number;
} {
  let count = 0;
  const runner: CmdRunner = {
    async run(command, opts) {
      count++;
      const r = spawnSync(command, {
        env: opts.env,
        shell: true,
        cwd: opts.cwd,
        timeout: opts.timeout_ms,
      });
      return {
        stdout: r.stdout ? r.stdout.toString() : "",
        stderr: r.stderr ? r.stderr.toString() : "",
        exitCode: r.status ?? -1,
      };
    },
  };
  return { runner, getCount: () => count };
}

function buildBrain(
  sessionId: string,
  buffer: LogEntry[],
  runner: CmdRunner,
): BrainDomain {
  const sessionLog = createSessionLog({ sessionId, buffer });
  return createBrain({ sessionId, secrets: {}, runner, sessionLog });
}

describe("L0S-T01", () => {
  describe("wake does not re-execute tools", () => {
    // 边界主场景：crash 后 wake，同一 tool_use_id 重放，重复副作用计数=0
    it("re-issuing the same tool_use_ids after wake does not re-execute (duplicate side-effect count = 0)", async () => {
      const buffer: LogEntry[] = [];
      const { runner, getCount } = makeCountingRunner();

      // harness 实例 1
      const brain1 = buildBrain("wake-1", buffer, runner);
      const obs_t1 = await brain1.execute("hands", cmdRun("t1", "echo first"));
      const obs_t2 = await brain1.execute("hands", cmdRun("t2", "echo second"));
      expect(getCount()).toBe(2);
      expect(obs_t1.stdout).toContain("first");
      expect(obs_t2.stdout).toContain("second");

      // 模拟 crash：新 harness 实例，复用同一 session log buffer
      const brain2 = buildBrain("wake-1", buffer, runner);
      const runState = await brain2.wake("wake-1");
      // wake 必须返回非空 RunState（重水化成功）
      expect(runState).toBeDefined();
      expect(runState).not.toBeNull();

      // 重放同一 tool_use_id —— 不得再次调用 runner
      const replay_t1 = await brain2.execute("hands", cmdRun("t1", "echo first"));
      const replay_t2 = await brain2.execute("hands", cmdRun("t2", "echo second"));

      // 重复副作用计数 = 0：runner 调用次数不变
      expect(getCount()).toBe(2);
      // 重放必须返回已持久化的同一 Observation（replay 契约）
      expect(replay_t1).toEqual(obs_t1 as Observation);
      expect(replay_t2).toEqual(obs_t2 as Observation);
    });

    // 正向控制：wake 后 brand-new tool_use_id 仍会真实执行
    it("wake re-executes only brand-new tool_use_ids (positive control)", async () => {
      const buffer: LogEntry[] = [];
      const { runner, getCount } = makeCountingRunner();

      const brain1 = buildBrain("wake-2", buffer, runner);
      await brain1.execute("hands", cmdRun("t1", "echo first"));
      expect(getCount()).toBe(1);

      const brain2 = buildBrain("wake-2", buffer, runner);
      await brain2.wake("wake-2");

      // 新 tool_use_id t3 —— 必须真实执行
      const obs_t3 = await brain2.execute("hands", cmdRun("t3", "echo third"));
      expect(getCount()).toBe(2);
      expect(obs_t3.stdout).toContain("third");
    });

    // 边界补充：同一 harness 实例内重复 tool_use_id 也不重执行（无需 crash）
    it("duplicate tool_use_id within a single session is not re-executed", async () => {
      const buffer: LogEntry[] = [];
      const { runner, getCount } = makeCountingRunner();
      const brain = buildBrain("wake-3", buffer, runner);

      const first = await brain.execute("hands", cmdRun("dup", "echo once"));
      expect(getCount()).toBe(1);
      const second = await brain.execute("hands", cmdRun("dup", "echo once"));
      expect(getCount()).toBe(1); // 不重执行
      expect(second).toEqual(first as Observation);
    });
  });
});
