// evolve-cli · 插件注册表（PLG-T08 registry.ts）。
//
// Spec: execution/plugin/TASKS.md §PLG-T08 接口签名逐字对齐：
//   loadRegistry(): Map<string, EvolvePluginFactory>
//   SUPPORTED_HARNESS: readonly string[]
// 静态 import 各插件包 factory（evolve-cli 单向依赖插件包，插件包不依赖
// evolve-cli——无循环，spec 执行提示 (2)）。dsh/grok（PLG-T11/T12）经
// generic adapter yaml 接入，不在 SUPPORTED_HARNESS 直注册。

import type { EvolvePluginFactory } from "@harness/evolve-core";
import type { LLMPort } from "@harness/l3-engine";
import { createCodexPlugin } from "@harness/evolve-codex";
import type { CodexAdapterOptions } from "@harness/evolve-codex";
import { createOpenCodePlugin } from "@harness/evolve-opencode";
import type { OpenCodeAdapterOptions } from "@harness/evolve-opencode";
import { createHermesPlugin } from "@harness/evolve-hermes";
import type { HermesAdapterOptions } from "@harness/evolve-hermes";
import { createOpenClawPlugin } from "@harness/evolve-openclaw";
import type { OpenClawAdapterOptions } from "@harness/evolve-openclaw";
import { createCursorPlugin } from "@harness/evolve-cursor";
import type { CursorAdapterOptions } from "@harness/evolve-cursor";
import { createGenericPlugin } from "@harness/evolve-generic";

/** 支持的 harness id（spec 声明顺序）。 */
export const SUPPORTED_HARNESS: readonly string[] = [
  "codex",
  "opencode",
  "hermes",
  "openclaw",
  "cursor",
  "generic",
];

/** harness id → 默认基质 id（init 无显式 --substrate-id 时推断）。 */
export const DEFAULT_SUBSTRATE_ID: Readonly<Record<string, string | null>> = {
  codex: "codex/AGENTS.md",
  opencode: "opencode/AGENTS.md",
  hermes: "hermes/skills/evolve/SKILL.md",
  openclaw: "openclaw/skills/evolve/SKILL.md",
  cursor: "cursor/rules/evolve.mdc",
  // generic 基质 id 由 adapter yaml pathMap 驱动（无静态默认）。
  generic: null,
};

/** registry 条目（静态注册表；每次 loadRegistry 返回新 Map 便于测试覆写）。 */
function buildEntries(): Array<[string, EvolvePluginFactory]> {
  return [
    [
      "codex",
      {
        harnessId: "codex",
        create: (o) => createCodexPlugin(o as unknown as CodexAdapterOptions),
      },
    ],
    [
      "opencode",
      {
        harnessId: "opencode",
        create: (o) => createOpenCodePlugin(o as unknown as OpenCodeAdapterOptions),
      },
    ],
    [
      "hermes",
      {
        harnessId: "hermes",
        create: (o) => createHermesPlugin(o as unknown as HermesAdapterOptions),
      },
    ],
    [
      "openclaw",
      {
        harnessId: "openclaw",
        create: (o) => createOpenClawPlugin(o as unknown as OpenClawAdapterOptions),
      },
    ],
    [
      "cursor",
      {
        harnessId: "cursor",
        create: (o) => createCursorPlugin(o as unknown as CursorAdapterOptions),
      },
    ],
    [
      "generic",
      {
        harnessId: "generic",
        create: (o) =>
          createGenericPlugin(
            String((o as { adapterYaml?: unknown }).adapterYaml ?? ""),
            (o as { llmPort?: unknown }).llmPort as LLMPort,
          ),
      },
    ],
  ];
}

/** 注册表：harnessId → factory。启动时静态注册全部 evolve-* 插件。 */
export function loadRegistry(): Map<string, EvolvePluginFactory> {
  return new Map(buildEntries());
}
