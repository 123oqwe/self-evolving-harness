#!/usr/bin/env node
// ISS-02 步骤②: compaction 结构代理任务 verify 脚本。
//
// 读取 `HARNESS_SUBSTRATE_PATH`(评分器注入)指向的基质文件，跑确定性结构检查，
// exit 0 = 结构不变量通过；非 0 = 结构退化。`--check <key>` 选择单检查(代理任务
// 按检查粒度拆分)，缺省跑全部检查。
//
// 运行: node scripts/check-compaction-proxy.mjs [--check <key>]  (cwd = repo root)

import { register } from "node:module";
import { pathToFileURL } from "node:url";
register(pathToFileURL("./scripts/lib/ts-resolve.mjs").href, import.meta.url);
import { readFileSync } from "node:fs";

const { checkCompactionPromptStructure } = await import("@harness/canary-eval");

function fail(msg) {
  console.error(`compaction-proxy FAIL: ${msg}`);
  process.exit(1);
}

const args = process.argv.slice(2);
let check = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--check") {
    check = args[++i];
  } else {
    fail(`unknown arg '${args[i]}'`);
  }
}

const substratePath = process.env.HARNESS_SUBSTRATE_PATH;
if (!substratePath) {
  fail("HARNESS_SUBSTRATE_PATH not set (substrate dependency not injected)");
}

let content;
try {
  content = readFileSync(substratePath, "utf8");
} catch (e) {
  fail(`cannot read substrate at ${substratePath}: ${e?.message ?? e}`);
}

const verdict = check
  ? checkCompactionPromptStructure(content, [check])
  : checkCompactionPromptStructure(content);

if (!verdict.ok) {
  fail(verdict.violations.join("\n"));
}

console.log(
  `compaction-proxy PASS: ${check ?? "all"} checks ok (${substratePath})`,
);
process.exit(0);
