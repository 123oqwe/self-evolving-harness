#!/usr/bin/env node
// CE-T01c · ABC 全量审计门（spec §CE-T01c 验收#2）。
//
// Spec contract (execution/canary-eval/TASKS.md §CE-T01c 验收):
//   "bash scripts/abc-audit.sh    # 全量 ABC 审计，exit 0=PASS/BUDGET_REPORTED，非0=FAIL"
//
// 对真实的 packages/canary-eval/canary/manifest.yaml 跑 runABCAudit（CE-T01c）：
//   - coverage 由调用方注入（G0 降级：官方 split loader 见 CE-T00c，行覆盖度量留 V1），
//     经 $CE_ABC_COVERAGE 环境变量传入（缺省 0 → 触发 BUDGET_REPORTED，合法 exit 0）。
//   - outcomeValidity 缺省按 true 信任（ERRATA-w2plus CE-05）。
//   - verdict=FAIL → exit 1（任一 taskValidity/outcomeValidity false 或 agentVisible）；
//   - verdict=PASS/BUDGET_REPORTED → exit 0。
//
// 由 scripts/abc-audit.sh 薄壳调用。

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const manifestPath = path.resolve(
  repoRoot,
  "packages/canary-eval/canary/manifest.yaml",
);

const abcAuditPath = path.resolve(
  repoRoot,
  "packages/canary-eval/src/canary/abc-audit.ts",
);
const loaderPath = path.resolve(
  repoRoot,
  "packages/canary-eval/src/canary/loader.ts",
);

const { runABCAudit } = await import(pathToFileURL(abcAuditPath).href);
const { loadCanary } = await import(pathToFileURL(loaderPath).href);

function fail(msg) {
  console.error(`CE-T01c abc-audit gate FAIL: ${msg}`);
  process.exit(1);
}

if (!existsSync(manifestPath)) {
  fail(`canary/manifest.yaml not found at ${manifestPath}`);
}

let manifest;
try {
  manifest = loadCanary(manifestPath);
} catch (e) {
  fail(`loadCanary threw: ${e?.message ?? e}`);
}

const coverageRaw = Number(process.env.CE_ABC_COVERAGE ?? 0);
const coverage = Number.isFinite(coverageRaw) ? coverageRaw : 0;

const result = runABCAudit(manifest, { coverage });

console.log(
  JSON.stringify(
    {
      verdict: result.verdict,
      coverage: result.coverage,
      taskValidity: result.taskValidity,
      outcomeValidity: result.outcomeValidity,
      unresolvedBudget: result.unresolvedBudget,
    },
    null,
    2,
  ),
);

if (result.verdict === "FAIL") {
  fail(`verdict=FAIL`);
}
process.exit(0);
