// evolve-cli · `evolve run`（PLG-T08 commands/run.ts）。
//
// Spec: execution/plugin/TASKS.md §PLG-T08 接口签名逐字对齐。
// 读 evolve.yaml → 装配 HarnessPort（registry factory + env opts）→
// runEvolutionCycle → 写 .harness/evolve-state.json。

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import type { EvolvePluginFactory, EvolveResult, EvolveConfig, EvolveCanaryTask } from "@harness/evolve-core";
import { runEvolutionCycle, InsufficientCanaryError } from "@harness/evolve-core";
import type { LLMPort } from "@harness/l3-engine";

import { loadRegistry } from "../registry.js";
import { readFlatYaml } from "../yaml.js";
import { writeState } from "../state.js";
import { resolveLlmPort } from "../llm.js";
import { UnsupportedHarnessError } from "./init.js";

/** evolve.yaml 不存在。 */
export class EvolveConfigNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvolveConfigNotFoundError";
  }
}

export interface RunOptions {
  readonly configPath?: string; // 默认 .harness/evolve.yaml
  readonly generations?: number; // 覆盖
  /**
   * 显式注入的 LLMPort（llmPort 歧义裁决：显式注入优先；缺省走
   * EVOLVE_LLM_* env 三元组，再缺省 fail-closed，见 src/llm.ts）。
   */
  readonly llmPort?: LLMPort;
  /** CLI `--llm <url>`（覆盖 EVOLVE_LLM_BASE_URL）。 */
  readonly llmFlag?: string;
}

/** evolve.yaml 解析结果。 */
interface EvolveYaml {
  readonly harness: string;
  readonly substrateId: string | null;
  readonly canaryGlob: string;
  readonly generations: number;
  readonly adapterYaml: string | null;
}

function loadEvolveYaml(cwd: string, configPath?: string): EvolveYaml {
  const rel = configPath ?? ".harness/evolve.yaml";
  const abs = join(cwd, rel);
  if (!existsSync(abs)) {
    throw new EvolveConfigNotFoundError(
      `evolve config not found: ${abs} (run 'evolve init --harness <id>' first)`,
    );
  }
  const doc = readFlatYaml(abs);
  const harness = doc.harness;
  if (typeof harness !== "string" || harness === "") {
    throw new EvolveConfigNotFoundError(`evolve config missing harness: ${abs}`);
  }
  return {
    harness,
    substrateId: typeof doc.substrateId === "string" ? doc.substrateId : null,
    canaryGlob: typeof doc.canaryGlob === "string" ? doc.canaryGlob : ".harness/canary/*.yaml",
    generations: typeof doc.generations === "number" ? doc.generations : 1,
    adapterYaml: typeof doc.adapterYaml === "string" ? doc.adapterYaml : null,
  };
}

/**
 * 读 canary 任务集（`.harness/canary/*.yaml`，每文件一个 flat
 * EvolveCanaryTask：id/verify/expectedExit）。glob 仅支持 `dir/*.yaml` 形态。
 */
export function loadCanaryTasks(glob: string, cwd: string): EvolveCanaryTask[] {
  const absGlob = join(cwd, glob);
  const star = absGlob.lastIndexOf("*");
  let files: string[];
  if (star >= 0) {
    // `dir/*.yaml` 形态：dir = `*` 前路径（去尾斜杠，空 → cwd）。
    const prefix = absGlob.slice(0, star).replace(/\/+$/, "");
    const dir = prefix === "" ? cwd : prefix;
    if (!existsSync(dir)) return [];
    const suffix = absGlob.slice(star + 1); // 如 ".yaml"
    files = readdirSync(dir)
      .filter((f) => f.endsWith(suffix))
      .sort()
      .map((f) => join(dir, f));
  } else if (existsSync(absGlob)) {
    files = [absGlob];
  } else {
    return [];
  }
  return files.map((f) => {
    const doc = readFlatYaml(f);
    const id = doc.id;
    const verify = doc.verify;
    if (typeof id !== "string" || typeof verify !== "string") {
      throw new Error(`invalid canary task file (need id/verify): ${f}`);
    }
    return {
      id,
      verify,
      expectedExit: typeof doc.expectedExit === "number" ? doc.expectedExit : 0,
    };
  });
}

/**
 * resolveAdapterOpts（spec REFACTOR 步）：按 harness 从 env 推断插件 opts
 * （CODEX_HOME/HERMES_HOME/OPENCLAW_* 等），repoRoot=cwd，llmPort 显式注入。
 */
export function resolveAdapterOpts(
  harness: string,
  cwd: string,
  yaml: EvolveYaml,
  opts: RunOptions,
  env: Record<string, string | undefined> = process.env,
  requireLlm = true,
): Record<string, unknown> {
  // 注入 factory（测试 hook）路径：factory 自带 llmPort（返回的 HarnessPort 持
  // 有），不在此处强制解析——llmPort 显式注入门仅约束真实 registry 装配路径。
  const llmPort = requireLlm ? resolveLlmPort(opts.llmPort, env, opts.llmFlag) : undefined;
  const port = (o: Record<string, unknown>): Record<string, unknown> =>
    llmPort === undefined ? o : { ...o, llmPort };
  switch (harness) {
    case "codex":
      return port({
        codexHome: env.CODEX_HOME ?? join(homedir(), ".codex"),
        repoRoot: cwd,
      });
    case "opencode":
      return port({
        configDir: env.OPENCODE_CONFIG_DIR ?? join(homedir(), ".config", "opencode"),
        dataDir: env.XDG_DATA_HOME
          ? join(env.XDG_DATA_HOME, "opencode")
          : join(homedir(), ".local", "share", "opencode"),
        repoRoot: cwd,
      });
    case "hermes":
      return port({
        hermesHome: env.HERMES_HOME ?? join(homedir(), ".hermes"),
        repoRoot: cwd,
      });
    case "openclaw":
      return port({
        workspaceDir:
          env.OPENCLAW_WORKSPACE_DIR ?? join(homedir(), ".openclaw", "workspace"),
        stateDir: env.OPENCLAW_STATE_DIR ?? join(homedir(), ".openclaw"),
        agentId: env.OPENCLAW_AGENT_ID ?? "main",
        repoRoot: cwd,
      });
    case "cursor":
      return port({ repoRoot: cwd });
    case "generic": {
      if (!yaml.adapterYaml) {
        throw new Error(
          "harness \"generic\" requires adapterYaml in evolve.yaml (re-run 'evolve init --harness generic --adapter-yaml <path>')",
        );
      }
      return port({ adapterYaml: join(cwd, yaml.adapterYaml) });
    }
    default:
      throw new UnsupportedHarnessError(
        `unsupported harness "${harness}"; supported: codex, opencode, hermes, openclaw, cursor, generic`,
      );
  }
}

async function runRunInternal(
  cwd: string,
  opts: RunOptions,
  factory?: EvolvePluginFactory,
): Promise<EvolveResult> {
  const yaml = loadEvolveYaml(cwd, opts.configPath);

  // canary 任务集：无匹配 → InsufficientCanaryError（spec 错误路径）。
  const canary = loadCanaryTasks(yaml.canaryGlob, cwd);
  if (canary.length === 0) {
    throw new InsufficientCanaryError(
      `canary glob "${yaml.canaryGlob}" matched no task files under ${cwd} (need >= 3)`,
    );
  }

  // 装配 HarnessPort：注入 factory（测试 hook）优先，否则 registry。
  const f = factory ?? loadRegistry().get(yaml.harness);
  if (!f) {
    throw new UnsupportedHarnessError(
      `unsupported harness "${yaml.harness}"; supported: codex, opencode, hermes, openclaw, cursor, generic`,
    );
  }
  const adapterOpts = resolveAdapterOpts(yaml.harness, cwd, yaml, opts, process.env, factory === undefined);
  const harnessPort = f.create(adapterOpts);

  if (!yaml.substrateId) {
    throw new Error(
      `evolve config missing substrateId (harness "${yaml.harness}" has no default; pass --substrate-id at init)`,
    );
  }

  const config: EvolveConfig = {
    harnessPort,
    substrateId: yaml.substrateId,
    canary,
    generations: opts.generations ?? yaml.generations,
    offline: yaml.harness === "cursor", // Cursor 无轨迹 → 离线模式（spec §PLG-T06/T10）
    workspaceDir: cwd,
  };
  const result = await runEvolutionCycle(config);
  writeState(cwd, result);
  return result;
}

/** `evolve run`：跑进化循环 + 写 evolve-state.json。 */
export async function runRun(opts: RunOptions, cwd: string): Promise<EvolveResult> {
  return runRunInternal(cwd, opts);
}

/**
 * 测试注入入口（T08-cli.spec.ts 假设的 runRunWithFactory）：以显式 factory
 * 装配 HarnessPort，绕过真实 registry + env 推断。
 */
export async function runRunWithFactory(
  cwd: string,
  opts: RunOptions,
  factory: EvolvePluginFactory,
): Promise<EvolveResult> {
  return runRunInternal(cwd, opts, factory);
}
