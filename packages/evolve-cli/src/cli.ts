// @harness/evolve-cli · 统一 CLI（PLG-T08）。
//
// Spec: execution/plugin/TASKS.md §PLG-T08。
// evolve init --harness <id> / evolve run / evolve status。
// arg 解析用 node:util parseArgs（Node 20+ 内置，无框架依赖，spec 执行提示 (1)）。

import { parseArgs } from "node:util";

import { runInit } from "./commands/init.js";
import type { InitOptions } from "./commands/init.js";
import { runRun } from "./commands/run.js";
import { runStatus } from "./commands/status.js";

const USAGE = `evolve — self-evolving harness CLI

usage: evolve <command> [options]

commands:
  init    scaffold .harness/evolve.yaml (requires --harness <id>)
  run     run evolution cycle (reads .harness/evolve.yaml, writes .harness/evolve-state.json)
  status  show last evolution run state (.harness/evolve-state.json)

options:
  --harness <id>        harness id: codex | opencode | hermes | openclaw | cursor | generic
  --adapter-yaml <p>    generic 专用 adapter yaml path
  --substrate-id <id>   substrate id (default: inferred per harness)
  --canary-glob <g>     canary task glob (default: .harness/canary/*.yaml)
  --generations <n>     evolution generations (default: 1)
  --config <path>       evolve.yaml path (default: .harness/evolve.yaml)
  --llm <url>           LLM base url (with EVOLVE_LLM_API_KEY / EVOLVE_LLM_MODEL env)
  --help                show this help
`;

/**
 * CLI 入口（可编程调用；返回退出码，不 process.exit——bin.ts 负责退出）。
 */
export async function runCli(args: string[], cwd: string): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      harness: { type: "string" },
      "adapter-yaml": { type: "string" },
      "substrate-id": { type: "string" },
      "canary-glob": { type: "string" },
      generations: { type: "string" },
      config: { type: "string" },
      llm: { type: "string" },
      help: { type: "boolean" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  // strict:false 下 parseArgs values 类型为 string|boolean|undefined——收窄辅助。
  const str = (v: string | boolean | undefined): string | undefined =>
    typeof v === "string" ? v : undefined;

  const command = positionals[0];
  try {
    switch (command) {
      case "init": {
        const harness = str(values.harness);
        if (!harness) {
          process.stderr.write("error: init requires --harness <id>\n\n");
          process.stderr.write(USAGE);
          return 1;
        }
        const adapterYaml = str(values["adapter-yaml"]);
        const substrateId = str(values["substrate-id"]);
        const canaryGlob = str(values["canary-glob"]);
        const opts: InitOptions = {
          harness,
          ...(adapterYaml !== undefined ? { adapterYaml } : {}),
          ...(substrateId !== undefined ? { substrateId } : {}),
          ...(canaryGlob !== undefined ? { canaryGlob } : {}),
        };
        await runInit(opts, cwd);
        process.stdout.write("wrote .harness/evolve.yaml\n");
        return 0;
      }
      case "run": {
        const generationsRaw = str(values.generations);
        const generations = generationsRaw
          ? parseInt(generationsRaw, 10)
          : undefined;
        const configPath = str(values.config);
        const llmFlag = str(values.llm);
        const result = await runRun(
          {
            ...(configPath !== undefined ? { configPath } : {}),
            ...(Number.isFinite(generations) && generations !== undefined
              ? { generations }
              : {}),
            ...(llmFlag !== undefined ? { llmFlag } : {}),
          },
          cwd,
        );
        process.stdout.write(
          `evolve run complete: retain=${result.retain} committed=${result.committed?.sha ?? "none"}\n`,
        );
        return 0;
      }
      case "status": {
        await runStatus(cwd);
        return 0;
      }
      default: {
        process.stderr.write(
          command
            ? `error: unknown command "${command}"\n\n`
            : "error: missing command\n\n",
        );
        process.stderr.write(USAGE);
        return 1;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    process.stderr.write(`error: ${message}\n`);
    return 1;
  }
}
