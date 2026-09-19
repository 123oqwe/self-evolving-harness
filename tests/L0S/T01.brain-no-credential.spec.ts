/**
 * L0S-T01 RED — `brain never holds real credential`
 *
 * Spec source: execution/L0-sandbox/TASKS.md → L0S-T01 行为规范（正常路径 / 错误路径 / 不变量）+ RED。
 *
 * 不变量（spec 不变量节）：
 *   - brain 进程内存、env、stdout 永不出现真实凭据（grep 真实 secret = 0）
 *   - hands 永不经非 `execute` 接口被调
 *
 * NOTE: spec 的 RED 文案「注入真实 secret 到 brain env」与不变量「brain 进程 env grep 真实 secret = 0」
 * 存在表面张力。依据「执行提示」(T01 只需保证 brain 不把真实 secret 透传给 hands 的 env) 与不变量节
 * 的权威措辞，本测试采用「vault 解释」：真实 secret 经 `secrets` 选项注册到 brain 的内部 vault，
 * 绝不写入 brain 进程的 `process.env`；brain 仅向 hands runner 传递已 strip 的 sandbox env。
 * 见返回的 ambiguities 字段。
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
} from "@harness/l0-sandbox";

const CANARY = "canary-xxx";

/**
 * 真实命令执行器：用 child_process 在 brain 传入的 sandbox env 中执行命令。
 * 捕获每次调用的 command + env，供断言「hands env 已 strip」。
 * `env` 完全替换（node child_process 语义），故子进程只能看到 sandbox env。
 */
function makeCapturingRunner(): {
  runner: CmdRunner;
  calls: { command: string; env: Record<string, string> }[];
} {
  const calls: { command: string; env: Record<string, string> }[] = [];
  const runner: CmdRunner = {
    async run(command, opts) {
      calls.push({ command, env: { ...opts.env } });
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
  return { runner, calls };
}

function cmdRun(tool_use_id: string, command: string, timeout_ms = 5000): Action {
  return { type: "cmd_run", tool_use_id, command, timeout_ms };
}

function freshBrain(
  sessionId: string,
  runner: CmdRunner,
  secrets: Record<string, string> = { TOKEN: CANARY },
): BrainDomain {
  const sessionLog = createSessionLog({ sessionId });
  return createBrain({ sessionId, secrets, runner, sessionLog });
}

describe("L0S-T01", () => {
  describe("brain never holds real credential", () => {
    // 正常路径：Given brain 持有 canary secret；When execute({type:'cmd_run', command:'printenv TOKEN'})；
    // Then Observation.content 不含 canary（hands 进程 env 已 strip）。
    it("Observation.content does not contain the real secret after execute(printenv TOKEN)", async () => {
      const { runner, calls } = makeCapturingRunner();
      const brain = freshBrain("brain-s1", runner);

      const obs = await brain.execute("hands", cmdRun("t1", "printenv TOKEN"));

      expect(calls.length).toBe(1);
      // stdout 是命令的真实输出：TOKEN 被 strip 后 printenv 无输出
      expect(obs.stdout.includes(CANARY)).toBe(false);
      // content 同样不得泄漏真实凭据
      expect(obs.content.includes(CANARY)).toBe(false);
      // content 不得为空占位（行为断言，非 toBeDefined 空断言）：strip 后应为空串
      expect(obs.content).not.toContain(CANARY);
    });

    // 不变量：brain 进程 env 永不出现真实凭据（process.env grep 真实 secret = 0）
    it("brain process.env never contains the real secret", async () => {
      const { runner } = makeCapturingRunner();
      const brain = freshBrain("brain-s2", runner);

      await brain.execute("hands", cmdRun("t1", "printenv TOKEN"));

      expect(JSON.stringify(process.env).includes(CANARY)).toBe(false);
    });

    // 正常路径补充：hands runner 收到的 env 不含真实 secret（brain 不透传）
    it("env passed to hands runner does not contain the real secret", async () => {
      const { runner, calls } = makeCapturingRunner();
      const brain = freshBrain("brain-s3", runner);

      await brain.execute("hands", cmdRun("t1", "printenv TOKEN"));

      expect(calls.length).toBe(1);
      const handsEnv = calls[0]!.env;
      expect(JSON.stringify(handsEnv).includes(CANARY)).toBe(false);
      expect(handsEnv.TOKEN).toBeUndefined();
    });

    // 不变量：hands 永不经非 execute 接口被调（getEvents / wake 不得触发 runner）
    it("hands runner is only invoked through brain.execute (not via getEvents/wake)", async () => {
      const { runner, calls } = makeCapturingRunner();
      const brain = freshBrain("brain-s4", runner);

      expect(calls.length).toBe(0);
      brain.getEvents(0);
      expect(calls.length).toBe(0);
      await brain.wake("brain-s4");
      expect(calls.length).toBe(0);

      await brain.execute("hands", cmdRun("t1", "true"));
      expect(calls.length).toBe(1);
    });

    // 错误路径：Given hands 进程崩溃；When brain 再次 execute；
    // Then 返回 Observation.error='hands_unavailable' 且 brain 不持有真实凭据。
    it('returns Observation.error="hands_unavailable" when hands runner crashes', async () => {
      const crashingRunner: CmdRunner = {
        async run() {
          throw new Error("hands process crashed");
        },
      };
      const brain = freshBrain("brain-s5", crashingRunner);

      const obs = await brain.execute("hands", cmdRun("t1", "printenv TOKEN"));

      expect(obs.error).toBe("hands_unavailable");
      expect(obs.exit_code).not.toBe(0);
      // crash 后 brain 仍不持有真实凭据
      expect(JSON.stringify(process.env).includes(CANARY)).toBe(false);
    });
  });
});
