#!/usr/bin/env node
// PLG-T09: agentskills.io skill bundle 生成器（ClaudeCode / Hermes 变体）。
//
// Spec: execution/plugin/TASKS.md §PLG-T09。
// 从 scripts/lib/templates.mjs 模板生成 skill-bundles/<host>/evolve/SKILL.md；
// 写盘前先做 frontmatter + body 自检（name/description 非空 + body 含
// `evolve run`），非法即 exit 非 0（spec 错误路径）。
// 只生成文件，不实现安装命令——安装属宿主 CLI / 手动拷贝（执行提示 (3)）。

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { skillBundleTargets, validateSkillMarkdown } from "./lib/templates.mjs";

const DIST_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const BUNDLES_DIR = join(DIST_ROOT, "skill-bundles");

for (const { dir, text } of skillBundleTargets()) {
  const label = `skill-bundles/${dir}/evolve/SKILL.md`;
  const verdict = validateSkillMarkdown(text, label);
  if (!verdict.ok) {
    process.stderr.write(`build-skill-bundles.mjs: ${verdict.reason}\n`);
    process.exit(1);
  }
  const outDir = join(BUNDLES_DIR, dir, "evolve");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "SKILL.md"), text, "utf8");
  process.stdout.write(`[evolve-dist] wrote ${label}\n`);
}
