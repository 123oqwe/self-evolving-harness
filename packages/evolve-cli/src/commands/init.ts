// evolve-cli · `evolve init`（PLG-T08 commands/init.ts）。
//
// Spec: execution/plugin/TASKS.md §PLG-T08 接口签名逐字对齐。
// 写 .harness/evolve.yaml（harness/substrateId/canaryGlob/adapterYaml?/generations）。

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { SUPPORTED_HARNESS, DEFAULT_SUBSTRATE_ID } from "../registry.js";
import { writeFlatYaml } from "../yaml.js";

/** 不支持的 harness id（列出 SUPPORTED_HARNESS）。 */
export class UnsupportedHarnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedHarnessError";
  }
}

export interface InitOptions {
  readonly harness: string; // harness id
  readonly adapterYaml?: string; // generic 专用
  readonly substrateId?: string; // 基质 id（默认按 harness 推断）
  readonly canaryGlob?: string; // canary 任务集 glob（默认 .harness/canary/*.yaml）
}

/** `evolve init`：scaffold .harness/evolve.yaml。 */
export async function runInit(opts: InitOptions, cwd: string): Promise<void> {
  const harness = opts.harness;
  if (!SUPPORTED_HARNESS.includes(harness)) {
    throw new UnsupportedHarnessError(
      `unsupported harness "${harness}"; supported: ${SUPPORTED_HARNESS.join(", ")}`,
    );
  }
  if (harness === "generic" && !opts.adapterYaml) {
    throw new UnsupportedHarnessError(
      `harness "generic" requires --adapter-yaml <path> ` +
      `(see ${SUPPORTED_HARNESS.join(", ")})`,
    );
  }

  const substrateId =
    opts.substrateId ?? DEFAULT_SUBSTRATE_ID[harness] ?? null;
  const canaryGlob = opts.canaryGlob ?? ".harness/canary/*.yaml";
  const adapterYaml = harness === "generic" ? (opts.adapterYaml ?? null) : null;

  const doc = {
    harness,
    substrateId,
    canaryGlob,
    generations: 1,
    adapterYaml,
  };
  const text = writeFlatYaml(doc, {
    adapterYaml: "generic 专用",
  });

  const cfgDir = join(cwd, ".harness");
  const cfgPath = join(cfgDir, "evolve.yaml");
  mkdirSync(cfgDir, { recursive: true });
  // 已存在时不静默覆盖（幂等保护）。
  if (existsSync(cfgPath)) {
    throw new Error(`evolve config already exists: ${cfgPath} (delete it first)`);
  }
  writeFileSync(cfgPath, text, "utf8");
}
