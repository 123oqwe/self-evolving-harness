// evolve-cli · evolve-state.json 读写（CLI 私有状态，不进 git）。
//
// Spec: execution/plugin/TASKS.md §PLG-T08（REFACTOR 步：state.json 读写抽
// src/state.ts）。state 是 EvolveResult 的 JSON 快照 + 时间戳。

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import type { EvolveResult } from "@harness/evolve-core";

export interface EvolveState extends EvolveResult {
  readonly updatedAt: string;
}

export function statePath(cwd: string): string {
  return join(cwd, ".harness", "evolve-state.json");
}

export function readState(cwd: string): EvolveState | null {
  const p = statePath(cwd);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as EvolveState;
}

export function writeState(cwd: string, result: EvolveResult): void {
  const p = statePath(cwd);
  mkdirSync(join(p, ".."), { recursive: true });
  const state: EvolveState = { ...result, updatedAt: new Date().toISOString() };
  writeFileSync(p, JSON.stringify(state, null, 2) + "\n", "utf8");
}
